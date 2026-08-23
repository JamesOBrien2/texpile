/* eslint-disable @typescript-eslint/no-explicit-any */
import { INDENT_PREFIX } from '../daemonIndent';
import { columnCandidates } from '../geometry/columnCandidates';
import { glyphRows } from '../geometry/glyphRows';
import { median } from '../geometry/median';
import { sameCodepoints, sameCodepointsDigitTolerant, sameOffsets } from '../geometry/rowEquality';
import type { Cal, CalBail, LocateContext } from './locate.types';

// Glyph-fingerprint location: find the daemon's typeset of the UNEDITED paragraph on the page
// by matching glyph codepoint rows. Pure content matching -- synctex only hints which page to
// search, so synctex attribution fuzziness (the chief "could not locate" source) drops out of
// the critical path. Indent-invariant (sequences, not x positions). An exact per-row match of
// all N rows is stronger evidence than any synctex anchor; a same-glyphs different-breaks
// match (daemon \noindent vs an indented paragraph) returns an approx cal for the provisional
// path. Ambiguity (identical paragraph twice) bails rather than guessing.
export async function locateByGlyphs(
	ctx: LocateContext,
	file: string,
	line: number,
	endLine: number,
	orig: string,
	listItem: boolean
): Promise<Cal | CalBail> {
	const bail = (why: string, detail?: unknown): CalBail => {
		ctx.emit('locate-glyph-bail', { why, ...(typeof detail === 'object' ? detail : { detail }) });
		return { bail: why };
	};
	const paper = ctx.paper();
	const pdf = ctx.pdfPath();
	if (!(paper.colW > 0)) return bail('no-colwidth');
	const W = paper.colW;
	const G = 8;
	// Calibration VARIANTS, matched empirically against the page (~2ms each, once per
	// paragraph per compile): indent x width. TeX indents mid-section paragraphs but the
	// daemon's box is \noindent, which shifts the first line's break. And under twocolumn
	// a starred float wraps at \textwidth, not \columnwidth -- rather than guessing which
	// blocks are full-width by name, typeset at BOTH engine-announced widths and let
	// whichever reproduces the page win. The winning variant's indent flag and width ride
	// on the cal so edited re-typesets reproduce the same breaks.
	const widths = [W];
	if (paper.textW > W + 2) widths.push(paper.textW);
	const variants: { lines: any[]; glyphs: any[]; indent: boolean; W: number }[] = [];
	for (const Wc of widths) {
		for (const ind of listItem ? [false] : [false, true]) {
			const cal = await ctx.typesetParagraph({ text: (ind ? INDENT_PREFIX : '') + orig, hsize: Wc });
			if (!cal.ok) continue;
			const lines = cal.records.filter((x: any) => x.t === 'line');
			if (!lines.length || (cal.stats && (cal.stats as any).certified === false)) continue;
			variants.push({ lines, glyphs: cal.records.filter((x: any) => x.t === 'g' || x.t === 'glyph'), indent: ind, W: Wc });
		}
	}
	if (!variants.length) return bail('cal-typeset-failed');
	const calGaps: number[] = [];
	for (let i = 1; i < variants[0].lines.length; i++) calGaps.push((variants[0].lines[i] as any).y - (variants[0].lines[i - 1] as any).y);
	const calGap = median(calGaps);
	const gap = calGap || 12;
	const rowsOf = (glyphs: any[]) => glyphRows(glyphs, gap);
	const varRows = variants.map((v) => ({ rows: rowsOf(v.glyphs), indent: v.indent, W: v.W })).filter((v) => v.rows.length);
	if (!varRows.length) return bail('no-daemon-glyphs');
	const N = varRows[0].rows.length;
	// page search order: synctex page hints (reliable at page granularity even when its line
	// attribution isn't), then the rest
	const hintPages: number[] = [];
	for (const ln of [line, endLine + 1]) {
		const sx: any = await ctx.synctex({ action: 'view', pdf, tex: file, line: ln, column: 0 });
		for (const b of ((sx && sx.boxes) || []) as any[]) if (b.page && !hintPages.includes(b.page)) hintPages.push(b.page);
	}
	const order = [...hintPages, ...ctx.pageNumbers().filter((p) => !hintPages.includes(p))];
	// tier 1: Nv contiguous rows matching a calibration variant, row for row. Pass 1 is
	// glyph-identical (can certify exact). Pass 2 tolerates digit-for-digit differences:
	// the daemon's counters are deterministic but not the page's (a second theorem, a
	// numbered equation), so a digit match is placement-true while the render differs --
	// always approx, and never by counter NAME (redefined/user-defined counters included).
	for (const rowEq of [sameCodepoints, sameCodepointsDigitTolerant]) {
		for (const pageNo of order) {
			if (ctx.rtlPage(pageNo)) continue; // record x-order is not the page's visual order here
			const allG = ctx.pageRecords(pageNo).filter((x: any) => x.t === 'g');
			if (!allG.length) continue;
			for (const v of varRows) {
				for (const cl of columnCandidates(allG, v.W, G)) {
					const colL = cl - G,
						colR = cl + v.W + G;
					const rows = rowsOf(allG.filter((x: any) => x.x >= colL && x.x <= colR));
					const dRows = v.rows,
						Nv = dRows.length;
					// placement anchor: band left minus daemon left = the daemon box origin on the
					// page (see locateForward's paraLeft note)
					const dLeft = Math.min(...dRows.map((r) => r.left));
					const starts: number[] = [];
					for (let s = 0; s + Nv <= rows.length; s++) {
						let okRun = true;
						for (let i = 0; i < Nv && okRun; i++) {
							if (!rowEq(rows[s + i].cs, dRows[i].cs) || !sameOffsets(rows[s + i], dRows[i])) okRun = false;
							else if (i > 0 && rows[s + i].y - rows[s + i - 1].y > gap * 1.5) okRun = false;
						}
						if (okRun) starts.push(s);
					}
					if (starts.length > 1) return bail('ambiguous', { matches: starts.length, pageNo });
					if (starts.length === 1) {
						const s = starts[0];
						const b1 = rows[s].y,
							bk = rows[s + Nv - 1].y;
						const paraLeft = Math.min(...rows.slice(s, s + Nv).map((r) => r.left)) - dLeft;
						const digits = rowEq !== sameCodepoints;
						// C2: natural band spacing -> exact. Stretched spacing (flushbottom
						// vertical justification) with content and x positions matching is still
						// the right paragraph in the right place: splice with natural spacing as
						// a close-enough PROVISIONAL and let the reconcile restore the stretch.
						if (calGap && Nv > 1) {
							const pg: number[] = [];
							for (let i = 1; i < Nv; i++) pg.push(rows[s + i].y - rows[s + i - 1].y);
							if (Math.abs(median(pg) - calGap) > 0.5) {
								ctx.emit('locate-glyph-stretched', { pageNo, b1, bk, N: Nv });
								return { pageNo, b1, bk, medGap: gap, paraLeft, W: v.W, colL, colR, indent: v.indent, approx: true };
							}
						}
						ctx.emit(digits ? 'locate-glyph-digits' : 'locate-glyph-ok', { pageNo, b1, bk, N: Nv, indent: v.indent });
						return { pageNo, b1, bk, medGap: gap, paraLeft, W: v.W, colL, colR, indent: v.indent, ...(digits ? { approx: true } : {}) };
					}
				}
			}
		}
	}
	const dRows = varRows[0].rows;
	const dLeft0 = Math.min(...dRows.map((r) => r.left));
	// tier 2: same glyphs, different breaks (indent shifts a line) -- slide a window of N+-1
	// contiguous rows and compare hyphen-stripped codepoint multisets. Hint pages only (the
	// multiset sweep is heavier than the early-exit exact compare).
	const HYPHENS = new Set([0x2d, 0xad, 0x2010]);
	const dAll: number[] = [];
	for (const r of dRows) for (const c of r.cs) if (!HYPHENS.has(c)) dAll.push(c);
	const dFreq = new Map<number, number>();
	for (const c of dAll) dFreq.set(c, (dFreq.get(c) || 0) + 1);
	const tol = Math.max(4, dAll.length * 0.02);
	type Fuzzy = { pageNo: number; b1: number; bk: number; left: number; colL: number; colR: number; diff: number; len: number };
	const found: Fuzzy[] = [];
	for (const pageNo of order.slice(0, Math.max(3, hintPages.length + 1))) {
		if (ctx.rtlPage(pageNo)) continue;
		const allG = ctx.pageRecords(pageNo).filter((x: any) => x.t === 'g');
		if (!allG.length) continue;
		for (const cl of columnCandidates(allG, W, G)) {
			const colL = cl - G,
				colR = cl + W + G;
			const rows = rowsOf(allG.filter((x: any) => x.x >= colL && x.x <= colR));
			for (const len of [N, N + 1, N - 1]) {
				if (len < 1) continue;
				for (let s = 0; s + len <= rows.length; s++) {
					let contiguous = true;
					for (let i = 1; i < len && contiguous; i++) if (rows[s + i].y - rows[s + i - 1].y > gap * 1.5) contiguous = false;
					if (!contiguous) continue;
					const freq = new Map<number, number>();
					let total = 0;
					for (let i = 0; i < len; i++)
						for (const c of rows[s + i].cs)
							if (!HYPHENS.has(c)) {
								freq.set(c, (freq.get(c) || 0) + 1);
								total++;
							}
					if (Math.abs(total - dAll.length) > tol) continue;
					let diff = 0;
					for (const [c, k] of dFreq) diff += Math.abs(k - (freq.get(c) || 0));
					for (const [c, k] of freq) if (!dFreq.has(c)) diff += k;
					if (diff <= tol)
						found.push({
							pageNo,
							b1: rows[s].y,
							bk: rows[s + len - 1].y,
							left: Math.min(...rows.slice(s, s + len).map((r) => r.left)) - dLeft0,
							colL,
							colR,
							diff,
							len
						});
				}
			}
		}
	}
	if (!found.length) return bail('not-on-page', { N });
	// windows of different lengths over the same paragraph overlap: group overlapping matches
	// and keep the best per group; >1 group = genuinely ambiguous
	found.sort((a, b) => a.pageNo - b.pageNo || a.b1 - b.b1);
	const groups: Fuzzy[][] = [];
	for (const f of found) {
		const g = groups[groups.length - 1];
		if (g && g[0].pageNo === f.pageNo && g[0].colL === f.colL && f.b1 <= g[g.length - 1].bk + gap) g.push(f);
		else groups.push([f]);
	}
	if (groups.length > 1) return bail('ambiguous', { matches: groups.length });
	const best = groups[0].sort((a, b) => a.diff - b.diff || Math.abs(a.len - N) - Math.abs(b.len - N))[0];
	ctx.emit('locate-glyph-approx', { pageNo: best.pageNo, b1: best.b1, bk: best.bk, len: best.len, N });
	return {
		pageNo: best.pageNo,
		b1: best.b1,
		bk: best.bk,
		medGap: gap,
		paraLeft: best.left,
		W,
		colL: best.colL,
		colR: best.colR,
		approx: true
	};
}
