<script lang="ts">
	// Shows the engine's output on screen and splices instant patches into it.
	// Everything painted came from the real engine (page records, the exact PDF at rest,
	// daemon typesets while typing); a patch applies ONLY where the C1/C2/C3 predicates
	// prove a real recompile would produce the same page, else it demotes to a tinted
	// provisional + reconcile or an honest full pass.
	// The locate ladder, overflow planning, and patch verification live in ./locate and
	// ./patch (pure modules, reached through the accessor contexts below); this component
	// keeps the view side: painting (records/PDF), asset caches, and the patch lifecycle.
	// opentype.js 2.x ESM has no default export -- use the namespace (opentype.parse)
	import * as opentype from 'opentype.js';
	import { tick, untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { ZoomIn, ZoomOut, MoveHorizontal, ChevronUp, ChevronDown, Crosshair, Download } from '@lucide/svelte';
	import { buildDrawList } from './renderCore';
	import { parseRecords, pageIsRtl } from './pageRecords';
	import { sfntFromTtc } from './ttc';
	import { parseT1, type T1Font } from './type1/t1font';
	import { BP2PT } from './texUnits';
	import { INDENT_PREFIX } from './daemonIndent';
	import { glyphRows } from './geometry/glyphRows';
	import { locateParagraph } from './locate/locateParagraph';
	import type { Cal, LocateContext } from './locate/locate.types';
	import { planOverflowSplit } from './patch/planOverflowSplit';
	import { verifyPatches } from './patch/verifyPatches';
	import type { Patch, PatchReq } from './patch/patch.types';
	import { getPdfDocument } from '$lib/pdf-view';
	import { native, fileUrl } from '$lib/workspace/fileSystem';
	import type { DraftPage } from '$lib/workspace/fileSystem';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		root: string;
		mainFile: string;
		/** bump to trigger a recompile (e.g. on save / compile press). */
		trigger: number;
		/** bump for a QUIET recompile: the page holds, no "Compiling…" announcement -- for
		 * boundary-line edits (comments, labels) whose render is expected unchanged. */
		quietTrigger?: number;
		/** SyncTeX inverse: a double-click on a page resolved to a source location. */
		onInverseSync?: (file: string, line: number, selectText?: string) => void;
		/** a compile landed: the editor re-evaluates any edits typed while it ran. */
		onSettled?: () => void;
		/** a compile landed: its log is at this path, for the Problems panel to parse. */
		onDiagnostics?: (logPath: string) => void;
	};
	let { root, mainFile, trigger, quietTrigger = 0, onInverseSync, onSettled, onDiagnostics }: Props = $props();

	let pages = $state<DraftPage[]>([]);
	let paper = $state({ w: 595, h: 842, colW: 0, textW: 0, fs: 0, mx: 72.27, my: 72.27 });
	let status = $state('');
	let error = $state<string | null>(null);
	let compiling = $state(false);
	// one live preview at a time: another window owns the warm engine (main's draftOwner);
	// this preview is paused until the user explicitly takes the engine over
	let busyElsewhere = $state(false);
	let canvasEls: HTMLCanvasElement[] = $state([]);

	/* eslint-disable @typescript-eslint/no-explicit-any */
	// font ids are per-compile (the daemon numbers fonts independently of the page
	// compile), so cache parsed fonts by FILE PATH and map ids per record-set
	const fontByFile = new Map<string, { ot?: any; t1?: T1Font } | null>();
	// Type1 fonts are cached per (pfb, enc) pair: the same pfb can be reencoded differently
	function t1Key(r: any) {
		return r.t1.pfb + '|' + (r.t1.enc || '');
	}
	// a .ttc collection holds several faces under one path: cache per (file, face)
	function otKey(r: any) {
		return r.sub ? `${r.file}#${r.sub}` : r.file;
	}
	const prevRecords = new Map<number, string>();
	const parsedPages = new Map<number, any[]>();
	const patchedPages = new Set<number>();
	// a live patch stays on screen after the fast path applies it; keep it so a zoom
	// re-render (which redraws from the untouched page records) re-applies it instead of
	// reverting. Cleared on a full compile (fresh records already carry the edit).
	const activePatch = new Map<number, Patch | Patch[]>(); // arrays = split patches (column spans)

	// ---- zoom / view state ----
	// 100% == actual physical size on a 96dpi display (matches the PDF viewer's zoom).
	const PT2PX = 96 / 72.27;
	const MIN_ZOOM = 0.2,
		MAX_ZOOM = 5;
	const PAGE_PAD = 16; // px gutter each side used by fit-width
	let zoom = $state(1);
	let fitMode = $state(true); // re-fit to the pane width on resize until the user zooms
	let containerW = $state(0); // measured inner width of the scroll area
	let curPage = $state(1); // page under the viewport, for the toolbar indicator
	let scroller = $state<HTMLDivElement | null>(null);
	const dispScale = $derived(PT2PX * zoom); // CSS px per TeX pt

	// test hook: structured decision log readable from Playwright via window.__draftEvents
	// (renderer console.log isn't reliably relayed through _electron). Capped so a long
	// session can't grow it without bound.
	function ev(kind: string, detail?: unknown) {
		const w = window as unknown as { __draftEvents?: unknown[] };
		const a = (w.__draftEvents ||= []);
		a.push({ kind, detail, t: performance.now() });
		if (a.length > 200) a.splice(0, a.length - 200);
	}

	async function ensureFonts(records: any[]) {
		// a classic Type1 font record carries `t1` ({ pfb, enc }) instead of a parseable file
		const jobs: Promise<void>[] = [];
		const seen = new Set<string>();
		for (const r of records) {
			if (r.t !== 'font') continue;
			const key = r.t1 ? t1Key(r) : otKey(r);
			if (!key || fontByFile.has(key) || seen.has(key)) continue;
			seen.add(key);
			jobs.push(
				(async () => {
					try {
						if (r.t1) {
							const [pfb, enc] = await Promise.all([
								fetch(fileUrl(r.t1.pfb), { cache: 'force-cache' }).then((x) => x.arrayBuffer()),
								r.t1.enc ? fetch(fileUrl(r.t1.enc), { cache: 'force-cache' }).then((x) => x.text()) : null
							]);
							const t1 = parseT1(new Uint8Array(pfb), enc);
							fontByFile.set(key, t1 ? { t1 } : null);
						} else {
							const buf = await (await fetch(fileUrl(r.file), { cache: 'force-cache' })).arrayBuffer();
							fontByFile.set(key, { ot: opentype.parse(sfntFromTtc(buf, (r.sub || 1) - 1)) });
						}
					} catch {
						fontByFile.set(key, null);
					}
				})()
			);
		}
		await Promise.all(jobs);
	}
	function idMapFor(records: any[]): Record<number, { ot?: any; t1?: T1Font; size: number } | null> {
		const m: Record<number, { ot?: any; t1?: T1Font; size: number } | null> = {};
		for (const r of records) {
			if (r.t !== 'font') continue;
			const key = r.t1 ? t1Key(r) : otKey(r);
			const f = key ? fontByFile.get(key) : null;
			m[r.id] = f ? { ot: f.ot, t1: f.t1, size: r.size } : null;
		}
		return m;
	}
	// any glyph whose font the renderer cannot ink (no font record, failed fetch/parse):
	// the patch GEOMETRY is still engine-exact, but the live frame would show a silent
	// gap where that ink belongs -- the caller demotes to provisional so the state reads
	// as approximate until the exact-PDF base shows the real glyphs
	async function missingInk(records: any[]): Promise<boolean> {
		await ensureFonts(records);
		const idMap = idMapFor(records);
		for (const r of records) if (r.t === 'g' && !idMap[r.f]) return true;
		return false;
	}

	// figure bitmaps, cached per file: PNG/JPG drawn directly, PDF figures rasterized once via
	// the app's shared pdf.js worker. Loading is async; the page repaints when a bitmap lands.
	const imgCache = new Map<string, ImageBitmap | 'loading' | 'failed'>();
	function ensureImage(file: string, pageNo: number, wpx: number) {
		if (imgCache.has(file)) return;
		imgCache.set(file, 'loading');
		(async () => {
			try {
				let bmp: ImageBitmap;
				if (/\.pdf$/i.test(file)) {
					// getPdfDocument, not getDocument: doc.destroy() below would otherwise take the shared
					// worker down with it, out from under the PDF viewer
					const task = await getPdfDocument({ url: fileUrl(file) });
					if (!task) throw new Error('no pdfjs');
					const doc = await task.promise;
					const pg = await doc.getPage(1);
					const base = pg.getViewport({ scale: 1 });
					// rasterize at ~2x the display size so zooming stays crisp, capped for huge figures
					const vp = pg.getViewport({ scale: Math.min(6, Math.max(1, (wpx * 2) / base.width)) });
					const c = document.createElement('canvas');
					c.width = Math.ceil(vp.width);
					c.height = Math.ceil(vp.height);
					await pg.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp }).promise;
					bmp = await createImageBitmap(c);
					void doc.destroy();
				} else {
					const blob = await (await fetch(fileUrl(file), { cache: 'force-cache' })).blob();
					bmp = await createImageBitmap(blob);
				}
				imgCache.set(file, bmp);
				ev('image-loaded', { file: file.split('/').pop(), page: pageNo });
				renderPage(pageNo, activePatch.get(pageNo)); // repaint with the real figure
			} catch (e) {
				imgCache.set(file, 'failed');
				ev('image-failed', { file: file.split('/').pop(), err: String(e).slice(0, 80) });
			}
		})();
	}

	// tier-2 pixel regions: raw-PDF drawing (tikz/pgfplots, rotated material) the walker
	// can't paint from records -- cropped out of the reconcile PDF of the SAME compile
	// via pdf.js. Cache clears on every compile success (PDF and geometry both change).
	const pixCache = new Map<string, ImageBitmap | 'loading' | 'failed'>();
	let pixDoc: Promise<any> | null = null;
	let pixGen = 0;
	function pixKey(pageNo: number, r: any): string {
		return `${pageNo}:${r.x.toFixed(2)},${r.y.toFixed(2)},${r.w.toFixed(2)},${r.h.toFixed(2)}`;
	}
	function invalidatePixels() {
		pixGen++;
		pixCache.clear();
		baseCache.clear(); // the exact-PDF page rasters come from THIS compile's PDF too
		pixDoc?.then((d) => d.destroy()).catch(() => {});
		pixDoc = null;
	}
	function ensurePixels(pageNo: number, r: any) {
		const key = pixKey(pageNo, r);
		if (pixCache.has(key)) return;
		pixCache.set(key, 'loading');
		const gen = pixGen;
		(async () => {
			try {
				if (!pixDoc)
					pixDoc = (async () => {
						// fetch bytes up front: range requests against a PDF latexmk may be rewriting would tear
						const buf = await (await fetch(fileUrl(root + '/_draft/draft.pdf'), { cache: 'no-store' })).arrayBuffer();
						const task = await getPdfDocument({ data: buf });
						if (!task) throw new Error('no pdfjs');
						return task.promise;
					})();
				const pg = await (await pixDoc).getPage(pageNo);
				// crop rect: records are pt from the (mx,my) text origin, PDF space is bp
				const PT2BP = 72 / 72.27;
				const s = Math.min(8, Math.max(1, dispScale * 2)); // ~2x display size so zooming stays crisp
				const cx = (paper.mx + r.x) * PT2BP * s;
				const cy = (paper.my + r.y - r.h) * PT2BP * s;
				const c = document.createElement('canvas');
				c.width = Math.max(1, Math.ceil(r.w * PT2BP * s));
				c.height = Math.max(1, Math.ceil((r.h + r.d) * PT2BP * s));
				const vp = pg.getViewport({ scale: s });
				// transparent background so the crop's edge can't erase a neighbour's overhang
				await pg.render({
					canvas: c,
					canvasContext: c.getContext('2d')!,
					viewport: vp,
					transform: [1, 0, 0, 1, -cx, -cy],
					background: 'rgba(0,0,0,0)'
				}).promise;
				const bmp = await createImageBitmap(c);
				if (gen !== pixGen) return; // a newer compile owns the cache now
				pixCache.set(key, bmp);
				ev('pixels-loaded', { page: pageNo, key });
				renderPage(pageNo, activePatch.get(pageNo));
			} catch (e) {
				if (gen === pixGen) pixCache.set(key, 'failed');
				ev('pixels-failed', { page: pageNo, err: String(e).slice(0, 80) });
			}
		})();
	}

	// ---- exact-PDF resting view ----
	// At rest each visible page paints a pdf.js raster of _draft/draft.pdf -- pixel-exact by
	// construction (true fonts, figures, tikz). The record canvas remains the LIVE overlay
	// while typing (patch composites below) and the automatic fallback when the PDF is
	// truncated by document errors (records ship regardless -- shipout-hook independence).
	const baseCache = new Map<string, ImageBitmap | 'loading' | 'failed'>();
	const BASE_MAX_PXPT = 5.5; // ~400dpi cap so deep zoom doesn't raster 30MP pages
	function basePxPt(dpr: number) {
		return Math.min(dispScale * dpr, BASE_MAX_PXPT);
	}
	function requestBaseAuto(n: number) {
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		requestBase(n, `${n}@${Math.round(basePxPt(dpr) * 100)}`);
	}
	function requestBase(n: number, key: string) {
		if (baseCache.has(key)) return;
		baseCache.set(key, 'loading');
		const gen = pixGen;
		void (async () => {
			try {
				if (!pixDoc)
					pixDoc = (async () => {
						const buf = await (await fetch(fileUrl(root + '/_draft/draft.pdf'), { cache: 'no-store' })).arrayBuffer();
						const task = await getPdfDocument({ data: buf });
						if (!task) throw new Error('no pdfjs');
						return task.promise;
					})();
				const pg = await (await pixDoc).getPage(n);
				// pdf space is bp; we want basePxPt pixels per TeX pt
				const scale = basePxPt(Math.min(2, window.devicePixelRatio || 1)) * (72.27 / 72);
				const vp = pg.getViewport({ scale });
				const c = document.createElement('canvas');
				c.width = Math.ceil(vp.width);
				c.height = Math.ceil(vp.height);
				await pg.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp } as any).promise;
				const bmp = await createImageBitmap(c);
				if (gen !== pixGen) return;
				baseCache.set(key, bmp);
				ev('base-loaded', { page: n, key });
				renderPage(n, activePatch.get(n));
			} catch (e) {
				if (gen === pixGen) baseCache.set(key, 'failed');
				ev('base-failed', { page: n, err: String(e).slice(0, 80) });
				// a page HELD on its last frame waiting for this raster must fall back to records
				if (gen === pixGen) renderPage(n, activePatch.get(n));
			}
		})();
	}
	function pageRecords(n: number): any[] {
		if (!parsedPages.has(n)) {
			const { records, dropped } = parseRecords(pages[n - 1]?.records ?? '');
			if (dropped) ev('records-unparseable', { page: n, dropped });
			parsedPages.set(n, records);
		}
		return parsedPages.get(n)!;
	}
	// a right-to-left page's records are in logical order while the PDF is in visual order, so
	// nothing on it may be painted or spliced from records -- it waits for the exact-PDF raster
	function rtlPage(n: number) {
		return pageIsRtl(pages[n - 1]?.unc);
	}

	// The body's bottom in record space: the shipout box baseline (ht) IS the footer line's
	// baseline, \footskip above it is the last body line. Capacity checks measure against
	// this; everything below it (the footer) is bottom-anchored and no patch may shift,
	// clip, or move it.
	function colBottomOf(p: number) {
		const m = pages[p - 1] as any;
		return m?.ht ? m.ht - paper.fs : m?.h || 1e9;
	}
	function contentFloor(p: number) {
		return colBottomOf(p) + 2;
	}

	// (patch-time image records draw as placeholders: which FILE a daemon image box shows
	// was a JS dimension-match guess that could swap same-sized figures -- deleted. The
	// reconcile's compile attaches filenames engine-side and paints the real figure.)
	function drawRecs(ctx: CanvasRenderingContext2D, records: any[], S: number, dy = 0, pageNo = 0) {
		const idMap = idMapFor(records);
		const { ops } = buildDrawList(records, (id) => idMap[id] || null, S, { glyphFill: '#000', ruleFill: '#000' });
		ctx.save();
		ctx.translate(paper.mx * S, (paper.my + dy) * S);
		for (const op of ops) {
			if (op.kind === 'glyph') {
				op.path.fill = op.fill;
				// a plain antialiased fill reads visibly thinner than the pdf.js raster it
				// replaces (measured ~25% lighter strokes): a hairline stroke restores the weight
				op.path.stroke = op.fill;
				op.path.strokeWidth = 0.3;
				op.path.draw(ctx);
			} else if (op.kind === 'rect') {
				ctx.fillStyle = op.fill;
				ctx.fillRect(op.x, op.y, op.w, op.h);
			} else if (op.kind === 'image') {
				const file = (op.rec as any)?.file as string | undefined;
				const bmp = file ? imgCache.get(file) : undefined;
				if (bmp && bmp !== 'loading' && bmp !== 'failed') {
					ctx.drawImage(bmp, op.x, op.y, op.w, op.h);
				} else {
					// unresolved or still loading -> geometry-exact placeholder
					ctx.fillStyle = '#e5e7eb';
					ctx.strokeStyle = '#9ca3af';
					ctx.fillRect(op.x, op.y, op.w, op.h);
					ctx.strokeRect(op.x, op.y, op.w, op.h);
					if (file && pageNo && !imgCache.has(file)) ensureImage(file, pageNo, op.w);
				}
			} else if (op.kind === 'pixels') {
				const bmp = pixCache.get(pixKey(pageNo, op.rec));
				if (bmp && bmp !== 'loading' && bmp !== 'failed') {
					ctx.drawImage(bmp, op.x, op.y, op.w, op.h);
				} else {
					// crop still rasterizing -> light geometry-exact placeholder
					ctx.fillStyle = '#f3f4f6';
					ctx.fillRect(op.x, op.y, op.w, op.h);
					if (pageNo) ensurePixels(pageNo, op.rec);
				}
			}
		}
		ctx.restore();
	}

	// ---- viewport windowing: only paint visible pages +-2 ----
	// Every page keeps its CSS-sized element (scroll geometry), but only windowed pages hold
	// a raster: at A4 x dpr2 each painted canvas is ~14MB of backing store, and repainting
	// every changed page after a reconcile stalled typing O(pages) on long documents.
	const WINDOW_PAD = 2;
	let winLo = 1;
	let winHi = 3;
	function inWindow(n: number) {
		return n >= winLo && n <= winHi;
	}
	let windowTimer: ReturnType<typeof setTimeout> | null = null;
	function updateWindow() {
		if (!scroller || !pages.length) return;
		const top = scroller.scrollTop;
		const bot = top + scroller.clientHeight;
		let lo = pages.length;
		let hi = 1;
		for (let i = 0; i < pages.length; i++) {
			const cv = canvasEls[i];
			if (!cv) continue;
			const o = pageOrigin(cv).top;
			const h = cv.clientHeight || paper.h * dispScale;
			if (o < bot && o + h > top) {
				lo = Math.min(lo, i + 1);
				hi = Math.max(hi, i + 1);
			}
		}
		if (hi < lo) {
			lo = curPage;
			hi = curPage;
		}
		winLo = Math.max(1, lo - WINDOW_PAD);
		winHi = Math.min(pages.length, hi + WINDOW_PAD);
		ev('window', { lo: winLo, hi: winHi, top: Math.round(top), bot: Math.round(bot) });
		for (let n = 1; n <= pages.length; n++) {
			const cv = canvasEls[n - 1];
			if (!cv) continue;
			if (inWindow(n) || activePatch.has(n)) {
				if (prevRecords.get(n) !== pages[n - 1].records || cv.width === 0)
					void renderPage(n).then(() => prevRecords.set(n, pages[n - 1].records));
			} else if (cv.width > 0) {
				// free the backing store; the CSS box stays so scroll geometry doesn't move
				cv.width = 0;
				cv.height = 0;
				prevRecords.delete(n);
			}
		}
	}
	function scheduleWindow() {
		if (windowTimer) clearTimeout(windowTimer);
		windowTimer = setTimeout(() => {
			windowTimer = null;
			updateWindow();
		}, 90);
	}
	// force the window onto a navigation/patch target so the scroll lands on painted pages
	function paintAround(n: number) {
		if (!pages.length) return;
		winLo = Math.max(1, n - WINDOW_PAD);
		winHi = Math.min(pages.length, n + WINDOW_PAD);
		for (let k = winLo; k <= winHi; k++) {
			const cv = canvasEls[k - 1];
			if (!cv) continue;
			if (prevRecords.get(k) !== pages[k - 1].records || cv.width === 0)
				void renderPage(k).then(() => prevRecords.set(k, pages[k - 1].records));
		}
	}

	async function renderPage(n: number, patch?: Patch | Patch[]) {
		const cv = canvasEls[n - 1];
		if (!cv) return;
		// windowed: plain repaints of off-screen pages wait for window entry; explicit patch
		// splices and pages carrying a live patch always paint (they are the user's focus)
		if (!patch && !activePatch.has(n) && !inWindow(n)) return;
		// a plain re-render (e.g. after a zoom) must re-apply any live patch on this page
		patch = patch ?? activePatch.get(n);
		const patches: Patch[] = !patch ? [] : Array.isArray(patch) ? patch : [patch];
		const records = pageRecords(n);
		await ensureFonts(records);
		for (const p of patches) await ensureFonts(p.newRecs);
		const S = dispScale;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		cv.width = Math.round(paper.w * S * dpr);
		cv.height = Math.round(paper.h * S * dpr);
		cv.style.width = paper.w * S + 'px';
		cv.style.height = paper.h * S + 'px';
		const ctx = cv.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, paper.w * S, paper.h * S);
		// exact-PDF base: paint the raster when it has landed for this compile+scale; the
		// records draw covers the page meanwhile (and permanently when the PDF is truncated)
		// the exact-PDF raster is the RESTING view only: pages carrying a live patch always
		// draw from records -- the proven splice renderer -- and snap to the pixel-exact
		// base when the patch clears on reconcile
		const bkey = `${n}@${Math.round(basePxPt(dpr) * 100)}`;
		const base = baseCache.get(bkey);
		const ready = !!base && base !== 'loading' && base !== 'failed';
		// an RTL page has no correct record rendering at all, so it takes the raster even under a
		// patch -- compositing patch ink onto it would put mirrored glyphs back on the page
		const rtl = rtlPage(n);
		if (ready && (!patches.length || rtl)) {
			ctx.drawImage(base as ImageBitmap, 0, 0, paper.w * S, paper.h * S);
			return;
		}
		if (!base) requestBase(n, bkey);
		// hold the white page until the raster lands rather than flash mirrored text. If the
		// raster can never land (a truncated PDF -- 'failed'), fall through: wrong-order ink still
		// carries the words, and a permanently blank page carries nothing.
		if (rtl && base !== 'failed') return;
		if (!patches.length) {
			drawRecs(ctx, records, S, 0, n);
			return;
		}
		// column-aware 3-way split per SEGMENT (page-box-local pt): each record belongs to the
		// segment whose column contains it -- drop that segment's band, shift its below-band
		// content by its delta; records outside every segment stay put. The page-number footer
		// sits in the bottom margin (below the content box height) and is bottom-anchored by
		// TeX -- never shift it with the flow.
		const meta = pages[n - 1] as any;
		const contentBottom = (meta?.ht || meta?.h || Infinity) + 2;
		const unchanged: any[] = [];
		const shifted: any[][] = patches.map(() => []);
		for (const r of records) {
			if (r.t === 'font') {
				unchanged.push(r);
				for (const a of shifted) a.push(r);
				continue;
			}
			// no y = non-positional record (endx, note markers): pass through untouched. A
			// NEGATIVE y is real content -- beamer headlines sit above the reference origin,
			// and skipping them here silently erased slide titles from every patched render.
			if (r.y === undefined) {
				unchanged.push(r);
				continue;
			}
			const y = r.y;
			const x = r.x ?? -1e4;
			const pi = patches.findIndex((p) => x >= p.colL && x <= p.colR);
			if (pi < 0 || y > contentBottom) {
				unchanged.push(r);
				continue;
			}
			const p = patches[pi];
			if (y < p.dropTop) unchanged.push(r);
			else if (y > p.dropBottom) {
				if (p.flowBottom !== undefined && y > p.flowBottom) unchanged.push(r);
				else if (p.clipBottom === undefined || y + p.delta <= p.clipBottom) shifted[pi].push(r);
			}
		}
		drawRecs(ctx, unchanged, S, 0, n);
		patches.forEach((p, i) => {
			drawRecs(ctx, shifted[i], S, p.delta, n);
			drawRecs(
				ctx,
				p.newRecs.map((r) => (r.t === 'font' ? r : { ...r, x: (r.x ?? 0) + p.paraLeft, y: (r.y ?? 0) + p.top })),
				S,
				0,
				n
			);
		});
	}

	// ---- instant per-paragraph patch (the "no delay while typing" path) ----

	type Cal = {
		pageNo: number;
		b1: number;
		bk: number;
		medGap: number;
		paraLeft: number;
		W: number;
		colL: number;
		colR: number;
		// found by the fuzzy inverse map (right glyphs, line count off by one, e.g. the daemon's
		// \noindent vs an indented page paragraph): good enough for a PROVISIONAL patch that a
		// full compile reconciles, never for an exact one
		approx?: boolean;
		// the page paragraph is indented (TeX indents mid-section paragraphs; the daemon's box is
		// \noindent): re-typesets of this paragraph must carry the \parindent prefix to reproduce
		// the same breaks
		indent?: boolean;
		// the paragraph STRADDLES a column break: b1/bk/colL/colR describe the FIRST (reading
		// order) part; `spill` is the continuation at the top of the next column -- or, when
		// pageNo is set, at the top of a column on the NEXT PAGE. Split patches are always
		// provisional.
		spill?: { b1: number; bk: number; colL: number; colR: number; paraLeft: number; pageNo?: number };
	};
	// geometry located once per paragraph per compile; keystrokes reuse it
	const calCache = new Map<string, Cal | { bail: string }>();

	// plain-language reason a paragraph can't take the instant path (shown in the status)
	function whyPhrase(reason: string): string {
		switch (reason) {
			case 'spans-pages':
			case 'spans-boundary':
			case 'break-inside':
				return m.draft_reason_column_or_page();
			case 'overflow':
				return m.draft_reason_overflow();
			case 'underflow':
				return m.draft_reason_underflow();
			case 'no-line-boxes':
			case 'no-anchor-glyphs':
			case 'no-page-records':
			case 'no-synctex-page':
			case 'no-page-glyphs':
			case 'no-run-of-N':
			case 'content-mismatch':
				return m.draft_reason_locate_failed();
			case 'synctex-span>N':
			case 'line-count':
			case 'spread':
			case 'glue-gap':
				return m.draft_reason_layout_mismatch();
			// page-rtl: the page's records are in logical order, not visual, so there is nothing
			// on it the instant path can splice against
			case 'page-rtl':
			case 'cal-uncertified':
			case 'cal-typeset-failed':
			case 'cal-empty':
			case 'typeset':
				return m.draft_reason_cannot_reproduce();
			case 'no-lines':
				return m.draft_reason_nothing_to_typeset();
			default:
				return m.draft_reason_needs_recompile();
		}
	}

	let patching = false;
	let patchingSince = 0;
	let queuedPatch: { file: string; line: number; endLine?: number; text: string; orig: string; transient?: boolean } | null = null;
	// pages showing a "close enough" provisional patch (the paragraph is exact, only the reflow
	// below is approximate) while a full compile reconciles the true layout -- tinted in the view
	let provisionalPages = $state(new Set<number>());
	// the reconcile after a provisional patch is DEBOUNCED: keep patching provisionally at typing
	// speed and run ONE full pass when the user pauses (an immediate recompile per keystroke lags)
	let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingReconcile: (() => void | Promise<void>) | null = null;
	// only complain if its slow
	let refineStatusTimer: ReturnType<typeof setTimeout> | null = null;
	function noteRefining(page: number) {
		if (refineStatusTimer) clearTimeout(refineStatusTimer);
		refineStatusTimer = setTimeout(() => {
			refineStatusTimer = null;
			if (provisionalPages.size) status = m.draft_status_refining({ page });
		}, 2000);
	}
	function scheduleReconcile(onRecompile: (() => void | Promise<void>) | undefined, stage: string) {
		pendingReconcile = onRecompile ?? null;
		if (reconcileTimer) clearTimeout(reconcileTimer);
		reconcileTimer = setTimeout(async () => {
			reconcileTimer = null;
			const r = pendingReconcile;
			pendingReconcile = null;
			await r?.();
			compile('provisional:' + stage);
		}, 700);
	}
	// a structural edit (new/split/deleted paragraph) has no patch to follow -- the editor
	// registers the paragraph that diverged, and after the recompile lands we locate it in the
	// fresh layout (content-based) and jump + highlight it there
	let pendingFocus: { file: string; line: number; endLine: number; text: string; listItem?: boolean } | null = null;
	export function focusAfterCompile(req: NonNullable<typeof pendingFocus>) {
		pendingFocus = req;
	}
	// yellow highlight over the band being edited (record-space, from the located cal); shown on
	// each patch and faded out shortly after the typing stops
	let editBand = $state<{ page: number; top: number; bottom: number; colL: number; colR: number } | null>(null);
	let editBandTimer: ReturnType<typeof setTimeout> | null = null;
	function showEditBand(b: NonNullable<typeof editBand>) {
		editBand = b;
		if (editBandTimer) clearTimeout(editBandTimer);
		editBandTimer = setTimeout(() => {
			editBandTimer = null;
			editBand = null;
		}, 1600);
	}

	// reactive state crosses into the extracted locate/patch modules through accessors
	// only, so a captured context never goes stale when a compile replaces pages/paper
	const locateCtx: LocateContext = {
		pdfPath: () => root + '/_draft/draft.pdf',
		paper: () => paper,
		pageNumbers: () => pages.map((p) => p.n),
		pageCount: () => pages.length,
		pageRecords,
		rtlPage,
		synctex: (b) => native()!.synctex(b as any),
		typesetParagraph: ({ text, hsize }) => daemonTypeset({ root, mainFile, text, hsize }),
		emit: ev
	};

	/** Instant path: re-typeset one edited paragraph on the warm daemon and splice it
	 * into its page -- ONLY when provably identical to a full recompile; else abandon
	 * and recompile immediately. Called by the editor on every edit burst. */
	export async function instantPatch(req: PatchReq) {
		const n = native();
		if (!n || !pages.length || compiling) {
			// while a compile is in flight, hold the latest edit; run it once compile finishes
			if (compiling) queuedPatch = req;
			ev('bail', !n ? 'no-native' : !pages.length ? 'no-pages' : 'compiling');
			return;
		}
		if (patching) {
			// a patch wedged mid-flight (a native call that never settled) must not swallow
			// every future edit silently: after 15s declare it dead and take over -- all the
			// daemon paths time out well under that, so the old run cannot still be live
			if (performance.now() - patchingSince > 15000) {
				ev('patch-stuck-reset', { since: Math.round(performance.now() - patchingSince) });
			} else {
				queuedPatch = req;
				ev('bail', 'patch-in-flight');
				return;
			}
		}
		patching = true;
		patchingSince = performance.now();
		const t0 = performance.now();
		// abandon -> save (so the recompile sees the buffer) + advance the editor's baseline,
		// then full-recompile
		async function recompile(stage: string, detail?: unknown) {
			// a TRANSIENT (auto-repaired mid-typing) edit may only patch or hold, never compile:
			// its source is a half-typed state not worth a full pass; the balanced keystroke
			// that follows re-evaluates normally
			if (req.transient) {
				ev('transient-hold', { stage });
				return;
			}
			ev('abandon', { stage, ...(typeof detail === 'object' ? detail : { detail }) });
			await req.onRecompile?.();
			// the daemon SURVIVES this: an abandon means "this edit renders via a full pass",
			// never an engine reload (that only happens on a preamble change)
			status = m.draft_status_recompiling({ reason: whyPhrase(stage) });
			compile('abandon:' + stage);
		}
		try {
			ev('patch-start', {
				file: req.file,
				line: req.line,
				origLen: req.orig.length,
				textLen: req.text.length,
				origHead: req.orig.slice(0, 50)
			});
			const key = `${req.file}:${req.line}`;
			let cal = calCache.get(key);
			if (!cal) {
				cal = await locateParagraph(locateCtx, req.file, req.line, req.orig, req.listItem, req.endLine);
				calCache.set(key, cal);
			}
			if ('bail' in cal) {
				// A page-PERMANENT bail is not worth a compile per keystroke. Most bail reasons
				// describe this edit against this layout, so recompiling produces a page the next
				// keystroke can patch -- worth doing at once. `page-rtl` is a property of the PAGE:
				// the recompile lands another right-to-left page, the next keystroke bails
				// identically, and the one after that. Left on the immediate path it ran a full
				// lualatex pass and an autosave on EVERY keystroke, which is what made typing in a
				// Hebrew document thrash. Debounced, it behaves the way a document with no live
				// preview does: recompile once, when the typing stops.
				if (cal.bail === 'page-rtl' || (cal as { invisible?: boolean }).invisible) {
					// page-rtl announces itself; an invisible paragraph (\eat, \footnotetext)
					// reconciles in silence -- each keystroke's full pass would show nothing new
					if (cal.bail === 'page-rtl') status = m.draft_status_recompiling({ reason: whyPhrase(cal.bail) });
					ev('abandon-debounced', { stage: cal.bail, key });
					scheduleReconcile(req.onRecompile, cal.bail);
					return;
				}
				await recompile(cal.bail, { key });
				return;
			}
			ev('located', { key, page: cal.pageNo });
			// cal.indent: the page paragraph is TeX-indented (the CALIBRATION discovered this
			// by typesetting both variants through the engine and matching the page), so the
			// edit carries the same engine-resolved \hspace*{\parindent}. An edit that changes
			// the paragraph's command set (e.g. typing \noindent) is cmdChanged and always
			// reconciles -- the engine certifies whatever the commands mean.
			const r = await daemonTypeset({ root, mainFile, text: (cal.indent && !req.listItem ? INDENT_PREFIX : '') + req.text, hsize: cal.W });
			if (!r.ok || (r.stats && (r.stats as any).certified === false)) {
				await recompile('typeset', { ok: r.ok });
				return;
			}
			const lineRecs = r.records.filter((x: any) => x.t === 'line');
			if (!lineRecs.length) {
				await recompile('no-lines');
				return;
			}
			const h1 = (lineRecs[0] as any).h ?? 7;
			const dk = (lineRecs[lineRecs.length - 1] as any).d ?? 2;
			if (cal.spill) {
				// SPLIT patch: the paragraph straddles a column break. Fill column A from the
				// paragraph's top to its capacity, spill the remaining lines to column B's top,
				// shift B's content below by the spill-height change. Always provisional.
				const colBottomS = colBottomOf(cal.pageNo);
				const capA = Math.max(1, Math.floor((colBottomS - (cal.b1 - h1)) / cal.medGap));
				const kA = Math.min(lineRecs.length, capA);
				const cutY = kA >= lineRecs.length ? Infinity : ((lineRecs[kA - 1] as any).y + (lineRecs[kA] as any).y) / 2;
				const recsA = r.records.filter((x: any) => x.t === 'font' || (x.y ?? 0) < cutY);
				const recsB = r.records.filter((x: any) => x.t === 'font' || (x.y ?? 0) >= cutY);
				const yFirstB = kA < lineRecs.length ? (lineRecs[kA] as any).y : 0;
				const newSpillH = kA < lineRecs.length ? (lineRecs[lineRecs.length - 1] as any).y - yFirstB : -cal.medGap;
				const segA: Patch = {
					top: cal.b1 - h1,
					dropTop: cal.b1 - h1 - 2,
					dropBottom: cal.bk + cal.medGap * 0.6,
					delta: 0,
					paraLeft: cal.paraLeft,
					colL: cal.colL,
					colR: cal.colR,
					newRecs: recsA
				};
				const spillOn = cal.spill.pageNo ?? cal.pageNo;
				const spillDelta = newSpillH - (cal.spill.bk - cal.spill.b1);
				const segB: Patch = {
					top: cal.spill.b1 - yFirstB,
					dropTop: cal.spill.b1 - h1 - 2,
					dropBottom: cal.spill.bk + dk + 2,
					delta: spillDelta,
					paraLeft: cal.spill.paraLeft,
					colL: cal.spill.colL,
					colR: cal.spill.colR,
					newRecs: kA < lineRecs.length ? recsB : [],
					flowBottom: contentFloor(spillOn),
					flowPred: glyphRows(
						pageRecords(spillOn).filter(
							(x) =>
								x.t === 'g' && x.x >= cal.spill!.colL && x.x <= cal.spill!.colR && x.y > cal.spill!.bk + 0.5 && x.y <= contentFloor(spillOn)
						),
						cal.medGap
					)
						.slice(0, 10)
						.map((rw) => ({ y: rw.y + spillDelta, cs: rw.cs }))
				};
				const spillPage = cal.spill.pageNo ?? cal.pageNo;
				if (spillPage !== cal.pageNo) {
					// cross-PAGE split: one segment per page canvas
					activePatch.set(cal.pageNo, segA);
					activePatch.set(spillPage, segB);
					await renderPage(cal.pageNo, segA);
					await renderPage(spillPage, segB);
					patchedPages.add(spillPage);
					provisionalPages = new Set(provisionalPages).add(cal.pageNo).add(spillPage);
				} else {
					const segs = [segA, segB];
					activePatch.set(cal.pageNo, segs);
					await renderPage(cal.pageNo, segs);
					provisionalPages = new Set(provisionalPages).add(cal.pageNo);
				}
				patchedPages.add(cal.pageNo);
				showEditBand({ page: cal.pageNo, top: cal.b1 - h1, bottom: cal.bk + dk, colL: cal.colL, colR: cal.colR });
				followEdit(cal.pageNo, cal.b1, cal.bk, cal.colL, cal.colR);
				status = m.draft_status_patched({ page: cal.pageNo, ms: (performance.now() - t0).toFixed(0) });
				noteRefining(cal.pageNo);
				ev('provisional-split', { page: cal.pageNo, spillPage, kA, of: lineRecs.length });
				if (!req.transient) scheduleReconcile(req.onRecompile, 'split');
				return;
			}
			// the band (cal.b1..bk) is measured in GLYPH-ROW baselines, so the daemon side must
			// be too: a tabular is ONE line record spanning the whole table (its baseline the
			// [c]-alignment center), and line-shape math placed it ~half a table off and read a
			// phantom under/overflow. Glyph rows are identical to line records for prose.
			const dRowsNew = glyphRows(
				(r.records as any[]).filter((x: any) => x.t === 'g'),
				cal.medGap
			);
			const y0 = dRowsNew.length ? dRowsNew[0].y : ((lineRecs[0] as any).y ?? 0);
			const yk = dRowsNew.length ? dRowsNew[dRowsNew.length - 1].y : ((lineRecs[lineRecs.length - 1] as any).y ?? 0);
			const delta = yk - y0 - (cal.bk - cal.b1);
			// C3: the column/page break must not move. A delta<=0 edit (same or fewer lines)
			// can't push content past the column bottom, so it's always safe on the overflow
			// side. When it GROWS, the content below the paragraph in this column shifts down
			// by delta and must still clear the column bottom: slack = column bottom - the
			// lowest content currently below the paragraph. (Measuring against the whole
			// column's last line was wrong -- on a full page that's ~0 even for a delta-0
			// edit near the top.)
			// slack = room below the paragraph before the column overflows. colBottom is the
			// shipped box bottom (~ the footer line). lastBelow is the lowest baseline that is
			// part of the CONTIGUOUS text flow under the paragraph -- walk down line by line and
			// stop at the big gap before an isolated footer/page-number, which sits in the bottom
			// margin and isn't content the paragraph could push off the page.
			const colBottom = colBottomOf(cal.pageNo);
			const floorA = contentFloor(cal.pageNo);
			const belowBases = [
				...new Set(
					pageRecords(cal.pageNo)
						.filter((x) => x.t === 'g' && x.x >= cal.colL && x.x <= cal.colR && x.y > cal.bk + 0.5 && x.y <= floorA)
						.map((x) => +x.y.toFixed(1))
				)
			].sort((a, b) => a - b);
			let lastBelow = cal.bk;
			for (const y of belowBases) {
				if (y - lastBelow > cal.medGap * 2.5) break; // jumped to the footer/header
				lastBelow = y;
			}
			const slack = colBottom - (lastBelow + dk);
			// C3: does the column/page break move? If so we can't PROVE the patch exact -- but the
			// paragraph itself is right, only the reflow below is approximate. So render it as a
			// close-enough placeholder now (tinted) and reconcile the true break with a full
			// compile, instead of freezing on "recompiling" with no visual update.
			const overflow = delta > 0 && delta > slack + 1;
			const underflow = delta < -0.7 * cal.medGap;
			// Overflow renders TRUTHFULLY: whatever the shift pushes past the column bottom
			// (the paragraph's own tail and/or the column's last rows) moves to the top of the
			// next slot in reading order -- the next column of this page, or the next page's
			// first column -- pushing that slot's content down, instead of cramming rows past
			// the bottom under the tint. Always provisional.
			if (overflow) {
				const plan = planOverflowSplit(
					{ pageRecords, contentFloor, pageCount: () => pages.length },
					cal,
					r.records as any[],
					lineRecs as any[],
					{ h1, dk, delta, colBottom, belowBases, lastBelow }
				);
				if (plan) {
					const { segA, segsB, samePage, spillPage } = plan;
					if (samePage) {
						// one canvas: the band segment and the next-column insert segments compose there
						const segs = [segA, ...segsB];
						activePatch.set(cal.pageNo, segs);
						await renderPage(cal.pageNo, segs);
					} else {
						activePatch.set(cal.pageNo, segA);
						activePatch.set(spillPage, segsB.length === 1 ? segsB[0] : segsB);
						await renderPage(cal.pageNo, segA);
						await renderPage(spillPage, segsB.length === 1 ? segsB[0] : segsB);
						patchedPages.add(spillPage);
					}
					patchedPages.add(cal.pageNo);
					provisionalPages = new Set(provisionalPages).add(cal.pageNo).add(spillPage);
					showEditBand({ page: cal.pageNo, top: segA.top, bottom: cal.bk + dk, colL: cal.colL, colR: cal.colR });
					followEdit(cal.pageNo, cal.b1, cal.bk + dk, cal.colL, cal.colR);
					ev('provisional-split', {
						page: cal.pageNo,
						spillPage,
						kA: plan.kA,
						of: plan.lineCount,
						moved: plan.movedCount,
						stage: 'overflow',
						target: samePage ? 'next-col' : 'next-page'
					});
					status = m.draft_status_patched({ page: cal.pageNo, ms: (performance.now() - t0).toFixed(0) });
					noteRefining(cal.pageNo);
					if (!req.transient) scheduleReconcile(req.onRecompile, 'overflow');
					return;
				}
			}
			// Footnote body text lives at the page bottom, outside the patch band: any
			// footnote-bearing paragraph reconciles. (A char-code signature comparison used to
			// license EXACT body patches -- deleted: it was blind to font/position changes, and
			// whether the page-bottom note block still matches is the engine's call.)
			const footnote = /\\footnote/.test(req.text) || /\\footnote/.test(req.orig);
			const fontGap = await missingInk(r.records as any[]);
			// an approx locate is placement-correct but break-inexact: always provisional. A
			// float-inner patch (tabular inside a \begin{table}) is provisional too: the cell
			// content is exact but auto column widths / float placement are the full pass's call.
			const provisionalStage = overflow
				? 'overflow'
				: underflow
					? 'underflow'
					: cal.approx
						? 'approx-locate'
						: req.floatInner
							? 'float-inner'
							: footnote
								? 'footnote'
								: fontGap
									? 'font-missing'
									: req.cmdChanged
										? 'command-changed'
										: null;
			// records anchor by glyph row (first daemon row baseline lands on b1); the wipe keeps
			// the line-shape extent too -- for a tabular that over-wipes into float glue, which
			// beats leaving the old table's ink outside a row-based band
			const top = cal.b1 - y0;
			const dropTop = cal.b1 - Math.max(h1, y0) - 2,
				dropBottom = cal.bk + dk + 2;
			const patchObj: Patch = {
				top,
				dropTop,
				dropBottom,
				delta,
				paraLeft: cal.paraLeft,
				colL: cal.colL,
				colR: cal.colR,
				newRecs: r.records as any[],
				flowBottom: floorA,
				flowPred: glyphRows(
					pageRecords(cal.pageNo).filter((x) => x.t === 'g' && x.x >= cal.colL && x.x <= cal.colR && x.y > cal.bk + 0.5 && x.y <= floorA),
					cal.medGap
				)
					.slice(0, 10)
					.map((rw) => ({ y: rw.y + delta, cs: rw.cs }))
			};
			activePatch.set(cal.pageNo, patchObj); // survive zoom re-renders until the next compile
			await renderPage(cal.pageNo, patchObj);
			patchedPages.add(cal.pageNo);
			showEditBand({ page: cal.pageNo, top, bottom: cal.bk + dk + Math.max(0, delta), colL: cal.colL, colR: cal.colR });
			followEdit(cal.pageNo, cal.b1, cal.bk + dk, cal.colL, cal.colR); // zoom+center on the edit (Typst-style)
			const ms = performance.now() - t0;
			if (provisionalStage) {
				provisionalPages = new Set(provisionalPages).add(cal.pageNo); // tint until the recompile lands
				ev('provisional', { stage: provisionalStage, page: cal.pageNo, delta: +delta.toFixed(1), transient: !!req.transient });
				status = m.draft_status_patched({ page: cal.pageNo, ms: ms.toFixed(0) });
				noteRefining(cal.pageNo);
				// debounced reconcile: the provisional render carries the typing; ONE full pass
				// runs after the user pauses instead of one per keystroke. Transient (repaired
				// mid-typing) edits never schedule one -- the balanced keystroke that follows will.
				if (!req.transient) scheduleReconcile(req.onRecompile, provisionalStage);
			} else {
				if (provisionalPages.has(cal.pageNo)) {
					const s = new Set(provisionalPages);
					s.delete(cal.pageNo);
					provisionalPages = s;
				}
				ev('patched', { page: cal.pageNo, delta: +delta.toFixed(1), ms: +ms.toFixed(0) });
				status = m.draft_status_patched({ page: cal.pageNo, ms: ms.toFixed(0) });
				// exact patches never advanced the baseline, so the FIRST edit in any other
				// paragraph read as two pending edits -> a visible full pass. A quiet pass at
				// the typing pause re-baselines, so moving to another section stays instant.
				if (!req.transient) scheduleReconcile(req.onRecompile, 'baseline');
			}
		} catch (e) {
			ev('error', String(e));
			// instant path is best-effort; the debounced full recompile always follows
		} finally {
			patching = false;
			if (queuedPatch) {
				const q = queuedPatch;
				queuedPatch = null;
				instantPatch(q);
			}
		}
	}

	// (The JS-placed provisional insert -- anchor flow walk, follower ceiling, medGap seam
	// arithmetic -- is deleted. Inserted/deleted paragraphs render ONLY via the merged
	// patch: dispatch typesets them riding the previous block as one engine unit, so the
	// engine supplies indent and spacing. What that path can't carry takes the full pass.)

	// Warm the per-paragraph daemon in the background: it loads the document preamble once
	// (heavy ones -- tikz/mhchem/etc. -- take ~1.5s), keyed by preamble hash, so the user's
	// first edit hits a ready daemon (~2ms) instead of paying the load. Fire-and-forget.
	let warmed = false;
	function warmDaemon() {
		if (warmed) return;
		warmed = true;
		const n = native();
		if (!n) return;
		const t = performance.now();
		// hsize 0 = the daemon falls back to its OWN engine-announced \columnwidth
		daemonTypeset({ root, mainFile, text: 'warm', hsize: paper.colW })
			.then((r) => {
				ev('daemon-warm', { ms: +(performance.now() - t).toFixed(0), ok: r.ok });
				// only announce readiness if nothing else took over the status meanwhile
				if (r.ok && !compiling && !patching) status = m.draft_status_warm_ready();
			})
			.catch(() => {
				warmed = false;
			});
	}

	// all daemon typesets funnel through here so an 'engine-busy' from ANY path (another
	// window holds the warm engine) pauses this preview instead of surfacing a raw error
	async function daemonTypeset(body: { root: string; mainFile: string; text: string; hsize?: number }) {
		const r = await native()!.draftTypeset(body);
		// cast, not narrow: svelte-check doesn't reliably narrow this cross-module union
		if (!r.ok && (r as { error?: string }).error === 'engine-busy') busyElsewhere = true;
		return r;
	}

	// explicit user action from the paused banner: steal the engine and start fresh here
	async function takeoverEngine() {
		const n = native();
		if (!n?.draftTakeover) return;
		try {
			await n.draftTakeover({ root });
		} catch {
			/* the engine may already be free */
		}
		busyElsewhere = false;
		void compile('takeover');
	}

	// the losing side of a takeover: main pushes this so we pause immediately instead of
	// showing a stale "ready" state until the next keystroke discovers engine-busy
	$effect(() => {
		const n = native();
		if (!n?.onDraftPreempted) return;
		return n.onDraftPreempted(() => {
			busyElsewhere = true;
			compiling = false;
			status = '';
		});
	});

	let compileToken = 0;
	async function compile(reason = 'trigger') {
		const n = native();
		if (!n || !root || !mainFile) return;
		if (busyElsewhere) return; // paused: don't fight the owning window on every trigger
		// cancel-on-supersede: don't queue behind an in-flight compile -- fire a fresh one. The
		// service kills the older run's lualatex, so a hung/slow compile never blocks the latest
		// edit (else the 120s pass timeout would freeze the preview). This run drops its own
		// result if a still-newer compile started before it returned (token guard).
		const myToken = ++compileToken;
		ev('compile-start', { reason });
		compiling = true;
		// a recompile after an abandon already shows "Left warm engine (...), recompiling…"
		// keep the "Recompiling (…)…" / "Refining…" status the caller set for an abandon or a
		// provisional reconcile; a quiet pass (boundary-line edit) announces nothing at all;
		// only a fresh compile announces "Compiling project…"
		if (!reason.startsWith('abandon:') && !reason.startsWith('provisional:') && !reason.startsWith('quiet:'))
			status = m.draft_status_compiling();
		error = null;
		try {
			const r = await n.draftCompile({ root, mainFile });
			if (myToken !== compileToken) {
				ev('compile-superseded', { reason });
				return;
			} // a newer compile owns the state now
			if (r.ok) {
				if (r.paperW > 0) {
					paper = { w: r.paperW, h: r.paperH, colW: r.colW, textW: r.textW || 0, fs: r.footSkip || 0, mx: r.marginX, my: r.marginY };
					if (fitMode) fitToWidth(); // size to the pane now that the paper dims are known
				}
				pages = r.pages;
				parsedPages.clear();
				calCache.clear(); // geometry changed; paragraphs re-locate on next patch
				invalidatePixels(); // tier-2 crops come from THIS compile's PDF
				// pages we patched must repaint even if their records didn't change
				for (const pn of patchedPages) prevRecords.delete(pn);
				patchedPages.clear();
				verifyPatches({ pageRecords, emit: ev }, activePatch); // grade every live patch against the engine's truth before dropping it
				activePatch.clear(); // fresh records already carry the edits
				editBand = null; // fresh layout may have shifted the band; don't highlight a stale spot
				await tick(); // let the {#each} create/resize canvases
				applyCssSizes(); // every page needs its CSS box (scroll geometry), painted or not
				let changed = 0;
				for (const p of pages) {
					if (!inWindow(p.n)) continue; // off-window pages paint on scroll-in
					if (prevRecords.get(p.n) !== p.records) {
						const cv = canvasEls[p.n - 1];
						if (cv && cv.width > 0) {
							// ONE visual swap per reconcile: hold the page's last frame (the
							// provisional patch, already ~the truth) and repaint once when the
							// fresh PDF raster lands -- painting records first and the raster
							// ~300ms later double-swapped the page at every typing pause
							requestBaseAuto(p.n);
						} else {
							await renderPage(p.n);
						}
						prevRecords.set(p.n, p.records);
						changed++;
					}
				}
				updateWindow();
				// drop stale hashes for removed pages
				for (const k of [...prevRecords.keys()]) if (k > pages.length) prevRecords.delete(k);
				const secs = (r.ms / 1000).toFixed(1);
				const pageCount =
					pages.length === 1 ? m.draft_compiled_pages_one({ count: pages.length }) : m.draft_compiled_pages_other({ count: pages.length });
				const passesSuffix = (r.passes ?? 1) > 1 ? ` · ${m.draft_compiled_passes({ passes: r.passes })}` : '';
				status = `${m.draft_status_compiled({ secs })} · ${pageCount}${passesSuffix}`;
				ev('compiled', { pages: pages.length, passes: r.passes ?? 1, changed, ms: r.ms });
				warmDaemon(); // preload the daemon (heavy preambles cost ~1.5s once) so the first edit patches instantly
				if (pendingFocus) {
					// jump to the structurally-edited paragraph in the fresh layout: its text is on
					// the page now, so the content-based locate can find it. Best effort.
					const f = pendingFocus;
					pendingFocus = null;
					locateParagraph(locateCtx, f.file, f.line, f.text, f.listItem, f.endLine)
						.then((fc) => {
							if ('bail' in fc) return;
							showEditBand({
								page: fc.pageNo,
								top: fc.b1 - fc.medGap * 0.8,
								bottom: fc.bk + fc.medGap * 0.3,
								colL: fc.colL,
								colR: fc.colR
							});
							followEdit(fc.pageNo, fc.b1, fc.bk, fc.colL, fc.colR);
						})
						.catch(() => {
							/* focus is cosmetic; never block the render on it */
						});
				}
			} else if (!(r as { superseded?: boolean }).superseded) {
				// svelte-check doesn't reliably narrow this cross-module discriminated union.
				// A service-side 'superseded' isn't an error -- the newer compile will render.
				const fail = r as { error: string; log?: string };
				if (fail.error === 'engine-busy') {
					// another window owns the live-preview engine: pause with the banner
					busyElsewhere = true;
					status = '';
				} else {
					// The message only, never fail.log. This banner's job is "the preview could not be
					// produced" -- lualatex missing, an unreadable manifest -- which is not a LaTeX
					// diagnostic and has no file or line to hang off, so nothing else can report it.
					// The log tail it used to carry is a dozen lines of exactly the diagnostics the
					// Problems panel now parses out of the same file, and rendering them here made the
					// banner tall enough to squeeze the pages out of the pane.
					error = fail.error;
					status = '';
				}
			}
		} catch (e) {
			if (myToken !== compileToken) return;
			error = e instanceof Error ? e.message : String(e);
			status = '';
		}
		// a newer compile may have started during the async render above; if so, leave the state
		// (compiling flag, queued patch) to it so we don't clear its in-flight status early
		if (myToken !== compileToken) return;
		compiling = false;
		if (provisionalPages.size) provisionalPages = new Set(); // reconcile finished: drop the tint
		if (queuedPatch) {
			// an edit arrived mid-compile; apply it against the fresh geometry
			const q = queuedPatch;
			queuedPatch = null;
			instantPatch(q);
		}
		// inserts/structural edits typed mid-compile could only bail; have the editor
		// re-evaluate the buffer against the fresh baseline now instead of waiting for the
		// next keystroke (the "typed during a reconcile, nothing showed" hole)
		onSettled?.();
		// The draft compile writes its OWN log, and nothing was reading it. The normal pipeline
		// polls the expected .log of the user's compile command; in live mode that command never
		// runs, so a document with real LaTeX errors reported nothing at all as long as the engine
		// still shipped pages -- which it does for most errors. The report that surfaced this had
		// babel refusing outright and every Hebrew glyph logged as missing, and the Problems panel
		// stayed empty through all of it.
		onDiagnostics?.(root + '/_draft/draft.log');
	}

	// recompile whenever `trigger` changes (and once on mount). untrack the compile call:
	// compile() reads and writes $state (compiling/pages/status), so without untrack this
	// effect would take those as dependencies and re-run itself into an infinite loop.
	$effect(() => {
		const t = trigger;
		untrack(() => compile('trigger:' + t));
	});
	// quiet passes (boundary-line edits): same compile, no announcement. 0 = never bumped,
	// so this never duplicates the mount compile above.
	$effect(() => {
		const t = quietTrigger;
		if (t > 0) untrack(() => compile('quiet:' + t));
	});

	// ---- zoom / fit ----
	function clampZoom(z: number) {
		return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
	}
	function fitToWidth() {
		if (!containerW || !paper.w) return;
		zoom = clampZoom((containerW - PAGE_PAD * 2) / (paper.w * PT2PX));
	}
	function setZoom(z: number) {
		fitMode = false;
		zoom = clampZoom(z);
	}
	function zoomIn() {
		return setZoom(zoom * 1.2);
	}
	function zoomOut() {
		return setZoom(zoom / 1.2);
	}
	function actualSize() {
		return setZoom(1);
	}
	function fitWidthBtn() {
		fitMode = true;
		fitToWidth();
	}

	// Zoom re-renders the canvases at the new resolution so text stays crisp, but that's
	// O(pages) work; during a rapid gesture we resize the canvas CSS box immediately (the
	// browser scales the existing bitmap -- instant, a touch soft) and re-render once the
	// gesture settles.
	let rerenderTimer: ReturnType<typeof setTimeout> | null = null;
	function applyCssSizes() {
		const S = dispScale;
		for (let i = 0; i < pages.length; i++) {
			const cv = canvasEls[i];
			if (!cv) continue;
			cv.style.width = paper.w * S + 'px';
			cv.style.height = paper.h * S + 'px';
		}
	}
	async function rerenderAll() {
		for (const p of pages) if (inWindow(p.n) || activePatch.has(p.n)) await renderPage(p.n);
	}
	// react to zoom changes (from buttons, wheel, or a fit-to-width): instant CSS resize +
	// debounced crisp re-render
	$effect(() => {
		void zoom;
		if (!pages.length) return;
		untrack(() => {
			applyCssSizes();
			if (rerenderTimer) clearTimeout(rerenderTimer);
			rerenderTimer = setTimeout(() => {
				rerenderTimer = null;
				rerenderAll();
			}, 140);
		});
	});
	// re-fit when the pane resizes, until the user takes manual control
	$effect(() => {
		void containerW;
		if (fitMode) untrack(() => fitToWidth());
	});

	// ctrl/cmd + wheel zooms; a plain wheel scrolls. The listener must be non-passive for
	// preventDefault to take, so attach it by hand once the scroller is bound.
	$effect(() => {
		const el = scroller;
		if (!el) return;
		function onWheel(e: WheelEvent) {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			untrack(() => setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
		}
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});
	// canvases sit inside position:relative wrappers (the tint/highlight overlays), so their
	// offsetTop/Left are relative to the WRAPPER (always ~0), not the scroller. Compute the page
	// origin within the scroller via bounding rects instead -- offsetTop here silently broke
	// followEdit, goToPage, and the page indicator when the wrappers became positioned.
	function pageOrigin(cv: HTMLElement): { top: number; left: number } {
		const s = scroller!;
		const cr = cv.getBoundingClientRect();
		const sr = s.getBoundingClientRect();
		return { top: cr.top - sr.top + s.scrollTop, left: cr.left - sr.left + s.scrollLeft };
	}
	function onScroll() {
		if (!scroller || !pages.length) return;
		// the page whose top is nearest the viewport top (a hair below it)
		const mid = scroller.scrollTop + 40;
		let best = 1,
			bestD = Infinity;
		for (let i = 0; i < canvasEls.length; i++) {
			const cv = canvasEls[i];
			if (!cv) continue;
			const d = Math.abs(pageOrigin(cv).top - mid);
			if (d < bestD) {
				bestD = d;
				best = i + 1;
			}
		}
		curPage = best;
		scheduleWindow();
	}
	function goToPage(n: number) {
		const clamped = Math.min(pages.length, Math.max(1, n));
		paintAround(clamped);
		const cv = canvasEls[clamped - 1];
		if (cv && scroller) scroller.scrollTo({ top: pageOrigin(cv).top - 12, behavior: 'smooth' });
	}

	// Typst-style follow: on each patch, pan the preview so the edited paragraph sits near the
	// vertical center (and horizontally on its column), with a tiny one-time zoom-in toward a
	// stable resting level just above fit-width. The zoom only ever increases and settles there,
	// so repeated edits neither runaway-zoom nor pull back a view the user zoomed in further; if
	// they're already zoomed past it, we just pan. Bounds are record-space: a point (x, y) draws
	// at canvas (paper.mx + x, paper.my + y) * dispScale.
	let followEdits = $state(true);
	const FOLLOW_ZOOM = 1.08; // a tiny magnification above fit-width, the follow resting level
	function followEdit(pageNo: number, bandTop: number, bandBottom: number, colL?: number, colR?: number) {
		if (!followEdits || !scroller) return;
		paintAround(pageNo);
		let zoomed = false;
		if (containerW && paper.w) {
			const target = clampZoom(((containerW - PAGE_PAD * 2) / (paper.w * PT2PX)) * FOLLOW_ZOOM);
			if (target > zoom + 1e-3) {
				setZoom(target);
				zoomed = true;
			}
		}
		function center() {
			const cv = canvasEls[pageNo - 1];
			if (!cv || !scroller) return;
			const S = dispScale;
			const org = pageOrigin(cv);
			const midY = org.top + (paper.my + (bandTop + bandBottom) / 2) * S;
			const toTop = Math.max(0, midY - scroller.clientHeight / 2);
			let toLeft = scroller.scrollLeft;
			if (colL != null && colR != null) {
				const midX = org.left + (paper.mx + (colL + colR) / 2) * S;
				toLeft = Math.max(0, Math.min(midX - scroller.clientWidth / 2, scroller.scrollWidth - scroller.clientWidth));
			}
			// skip a redundant scroll when the edit is already centered, so continuous typing in one
			// paragraph doesn't re-issue a smooth scroll every keystroke
			if (Math.abs(toTop - scroller.scrollTop) > 4 || Math.abs(toLeft - scroller.scrollLeft) > 4)
				scroller.scrollTo({ top: toTop, left: toLeft, behavior: 'smooth' });
		}
		if (zoomed)
			tick().then(center); // wait for the zoom's css resize + reflow so offsets are current
		else center();
	}

	// ---- SyncTeX in the live preview ----
	// The word under a click, rebuilt from the page's glyph records (same baseline row,
	// expanded to the nearest space-gaps). It anchors the source jump against line drift,
	// exactly like the PDF viewer's double-clicked word. Type1 slots map to text through
	// the parsed font's AGL table; anything unmappable just ends the word.
	function wordAt(n: number, xPt: number, yPt: number): string | undefined {
		const records = pageRecords(n);
		const uniOf: Record<number, { uni?: number[]; size: number }> = {};
		for (const r of records)
			if (r.t === 'font') uniOf[r.id] = { uni: r.t1 ? fontByFile.get(t1Key(r))?.t1?.textMap : undefined, size: r.size || 10 };
		// glyphs whose baseline sits just below the click (text spans roughly [y-0.8em, y+0.2em])
		const band = records.filter((r: any) => r.t === 'g' && r.y >= yPt - 2 && r.y <= yPt + 9);
		if (!band.length) return undefined;
		const base = band.reduce((b: any, g: any) => (Math.abs(g.y - yPt - 4) < Math.abs(b.y - yPt - 4) ? g : b)).y;
		const row = band.filter((g: any) => Math.abs(g.y - base) < 2).sort((a: any, b: any) => a.x - b.x);
		let i = row.findIndex((g: any) => xPt >= g.x && xPt <= g.x + (g.w || 0));
		if (i < 0) i = row.reduce((bi: number, g: any, gi: number) => (Math.abs(g.x - xPt) < Math.abs(row[bi].x - xPt) ? gi : bi), 0);
		function gapAfter(k: number) {
			return row[k + 1].x - (row[k].x + (row[k].w || 0));
		}
		function isGap(k: number) {
			return gapAfter(k) > Math.max(0.9, 0.13 * (uniOf[row[k].f]?.size || 10));
		}
		let lo = i,
			hi = i;
		while (lo > 0 && !isGap(lo - 1)) lo--;
		while (hi < row.length - 1 && !isGap(hi)) hi++;
		let word = '';
		for (let k = lo; k <= hi; k++) {
			const g = row[k];
			const u = uniOf[g.f]?.uni;
			const cp = u ? u[g.c] || 0 : g.c;
			if (cp < 32 || cp > 0xffff) return word.length >= 2 ? word : undefined; // ligature/PUA: keep what we have
			word += String.fromCodePoint(cp);
		}
		return word.length >= 2 ? word : undefined;
	}

	// click feedback: an instant ring pulse where the double-click landed, so the sync
	// action is visible even before synctex resolves. Page-absolute pt, like the click.
	let clickMark = $state<{ page: number; x: number; y: number } | null>(null);
	let clickMarkTimer: ReturnType<typeof setTimeout> | null = null;
	function showClickMark(page: number, x: number, y: number) {
		clickMark = { page, x, y };
		if (clickMarkTimer) clearTimeout(clickMarkTimer);
		clickMarkTimer = setTimeout(() => {
			clickMarkTimer = null;
			clickMark = null;
		}, 900);
	}

	// inverse: double-click a page -> source location via the reconcile PDF's synctex
	async function onCanvasDblClick(n: number, e: MouseEvent) {
		const nat = native();
		if (!nat || !onInverseSync) return;
		const xPt = e.offsetX / dispScale;
		const yPt = e.offsetY / dispScale;
		showClickMark(n, xPt, yPt);
		try {
			const res: any = await nat.synctex({ action: 'edit', pdf: root + '/_draft/draft.pdf', page: n, x: xPt / BP2PT, y: yPt / BP2PT });
			ev('inverse-sync', { page: n, x: +xPt.toFixed(1), y: +yPt.toFixed(1), input: res?.input, line: res?.line });
			if (res?.ok && res.input && res.line >= 1) onInverseSync(res.input, res.line, wordAt(n, xPt - paper.mx, yPt - paper.my));
		} catch {
			/* sync is best-effort */
		}
	}

	// Save the reconcile PDF (the exact document the canvases mirror). A pending reconcile
	// or in-flight compile means the PDF is behind the preview: flush/refresh it first so
	// the saved file never trails the last edit.
	let savingPdf = $state(false);
	async function savePdf() {
		const nat = native();
		if (!nat || savingPdf || !pages.length) return;
		savingPdf = true;
		try {
			if (reconcileTimer) {
				clearTimeout(reconcileTimer);
				reconcileTimer = null;
				const r = pendingReconcile;
				pendingReconcile = null;
				await r?.();
				await compile('save-pdf');
			} else if (compiling) {
				await compile('save-pdf'); // supersedes the in-flight run; this one owns the result
			}
			const name =
				mainFile
					.split('/')
					.pop()!
					.replace(/\.tex$/i, '') + '.pdf';
			const res = await nat.draftSavePdf({ root, defaultName: name });
			ev('save-pdf', { saved: res.saved, path: res.path });
			if (res.saved && res.path) status = m.draft_status_pdf_saved({ path: res.path });
		} catch (e) {
			status = m.draft_status_pdf_save_failed({ message: e instanceof Error ? e.message : String(e) });
		} finally {
			savingPdf = false;
		}
	}

	// forward: scroll + flash the box synctex reported for a source line (all args bp, v = baseline)
	export function syncTo(pageNo: number, hBp: number, vBp: number, wBp: number, hgtBp: number) {
		if (pageNo < 1 || pageNo > pages.length) return;
		const colL = hBp * BP2PT - paper.mx;
		const bottom = vBp * BP2PT - paper.my;
		const top = bottom - Math.max(6, hgtBp * BP2PT);
		const colR = colL + Math.max(20, wBp * BP2PT);
		ev('forward-sync', { page: pageNo, top: +top.toFixed(1), bottom: +bottom.toFixed(1) });
		showEditBand({ page: pageNo, top, bottom, colL, colR });
		const keep = followEdits;
		followEdits = true; // an explicit sync always navigates, even with follow-edits off
		followEdit(pageNo, top, bottom, colL, colR);
		followEdits = keep;
	}
</script>

<div class="bg-surface-200-800 flex h-full w-full flex-col">
	<!-- one toolbar row: status on the left, zoom + page-nav on the right ("Draft preview"
	     already labels the pane header above) -->
	<div class="border-surface-300-700 text-surface-600-300 flex min-h-10 shrink-0 items-center gap-1 border-b px-2 text-xs">
		{#if error}<span class="text-error-500 shrink-0">{m.draft_preview_error_label()}</span>{:else}<span
				class="text-surface-700-200 truncate">{status}</span
			>{/if}
		<div class="flex-1"></div>
		<button
			class="hover:preset-tonal rounded p-1 disabled:opacity-40"
			onclick={savePdf}
			disabled={!pages.length || savingPdf}
			title={m.draft_toolbar_save_pdf()}
			aria-label={m.draft_toolbar_save_pdf()}
		>
			<Download class="size-4" />
		</button>
		<span class="bg-surface-300-700 mx-1 h-4 w-px shrink-0"></span>
		<button
			class="hover:preset-tonal rounded p-1 disabled:opacity-40"
			onclick={zoomOut}
			disabled={!pages.length}
			title={m.draft_toolbar_zoom_out()}
			aria-label={m.draft_toolbar_zoom_out()}
		>
			<ZoomOut class="size-4" />
		</button>
		<button
			class="hover:preset-tonal min-w-11 rounded px-1 py-1 text-center tabular-nums"
			onclick={actualSize}
			disabled={!pages.length}
			title={m.draft_toolbar_actual_size()}
		>
			{Math.round(zoom * 100)}%
		</button>
		<button
			class="hover:preset-tonal rounded p-1 disabled:opacity-40"
			onclick={zoomIn}
			disabled={!pages.length}
			title={m.draft_toolbar_zoom_in()}
			aria-label={m.draft_toolbar_zoom_in()}
		>
			<ZoomIn class="size-4" />
		</button>
		<button
			class="hover:preset-tonal rounded p-1 disabled:opacity-40"
			class:preset-tonal={fitMode}
			onclick={fitWidthBtn}
			disabled={!pages.length}
			title={m.draft_toolbar_fit_width()}
			aria-label={m.draft_toolbar_fit_width()}
		>
			<MoveHorizontal class="size-4" />
		</button>
		<button
			class="hover:preset-tonal rounded p-1 disabled:opacity-40"
			class:preset-tonal={followEdits}
			class:text-primary-500={followEdits}
			onclick={() => (followEdits = !followEdits)}
			disabled={!pages.length}
			title={followEdits ? m.draft_toolbar_follow_edits_on() : m.draft_toolbar_follow_edits_off()}
			aria-label={m.draft_toolbar_follow_edits_aria()}
			aria-pressed={followEdits}
		>
			<Crosshair class="size-4" />
		</button>
		{#if pages.length}
			<span class="bg-surface-300-700 mx-1 h-4 w-px shrink-0"></span>
			<button
				class="hover:preset-tonal rounded p-1 disabled:opacity-40"
				onclick={() => goToPage(curPage - 1)}
				disabled={curPage <= 1}
				title={m.draft_toolbar_prev_page()}
				aria-label={m.draft_toolbar_prev_page()}
			>
				<ChevronUp class="size-4" />
			</button>
			<span class="shrink-0 tabular-nums">{curPage} / {pages.length}</span>
			<button
				class="hover:preset-tonal rounded p-1 disabled:opacity-40"
				onclick={() => goToPage(curPage + 1)}
				disabled={curPage >= pages.length}
				title={m.draft_toolbar_next_page()}
				aria-label={m.draft_toolbar_next_page()}
			>
				<ChevronDown class="size-4" />
			</button>
		{/if}
	</div>
	{#if busyElsewhere}
		<div class="border-surface-300-700 bg-surface-50-950 m-3 flex shrink-0 items-center justify-between gap-3 rounded border p-3 text-sm">
			<span class="text-surface-600-300">{m.draft_busy_other_window()}</span>
			<button class="btn btn-xs preset-filled-primary-500 shrink-0" onclick={takeoverEngine}>{m.draft_busy_takeover()}</button>
		</div>
	{/if}
	{#if error}
		<!-- Now a single line in the normal case (the log tail moved to Problems), but the cap stays
		     as a backstop: `error` can also be a thrown exception's message, and overflow-auto cannot
		     scroll a box that is free to grow. Without a height constraint this took its full content
		     height and the flex-1 scroller below it got whatever was left. -->
		<pre class="text-error-500 bg-surface-50-950 m-3 max-h-40 shrink-0 overflow-auto rounded p-3 text-xs whitespace-pre-wrap">{error}</pre>
	{/if}
	<div
		bind:this={scroller}
		bind:clientWidth={containerW}
		onscroll={onScroll}
		class="flex flex-1 flex-col items-center gap-4 overflow-auto p-4"
	>
		{#each pages as p (p.n)}
			<div class="relative shadow-lg">
				<canvas bind:this={canvasEls[p.n - 1]} ondblclick={(e) => onCanvasDblClick(p.n, e)}></canvas>
				{#if provisionalPages.has(p.n)}
					<!-- close-enough placeholder: STATIC subtle tint while the full compile reconciles
				     this page (a pulsing overlay reads as flicker during continuous typing) -->
					<div class="pointer-events-none absolute inset-0 bg-primary-500/10" transition:fade={{ duration: 150 }}></div>
				{/if}
				{#if editBand && editBand.page === p.n}
					<!-- the located band of the paragraph being edited; fades shortly after typing stops -->
					<div
						class="pointer-events-none absolute rounded-sm bg-yellow-300/30"
						transition:fade={{ duration: 300 }}
						style="left:{(paper.mx + editBand.colL) * dispScale}px; top:{(paper.my + editBand.top - 2) *
							dispScale}px; width:{(editBand.colR - editBand.colL) * dispScale}px; height:{(editBand.bottom - editBand.top + 4) *
							dispScale}px"
					></div>
				{/if}
				{#if clickMark && clickMark.page === p.n}
					<!-- where the sync double-click landed -->
					<div
						class="pointer-events-none absolute"
						transition:fade={{ duration: 200 }}
						style="left:{clickMark.x * dispScale}px; top:{clickMark.y * dispScale}px"
					>
						<span class="border-primary-500 absolute size-6 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2"></span>
						<span class="bg-primary-500 absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"></span>
					</div>
				{/if}
			</div>
			<div class="text-surface-500 -mt-3 text-[10px]">{m.draft_page_label({ n: p.n })}</div>
		{/each}
	</div>
</div>
