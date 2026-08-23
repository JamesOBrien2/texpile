// Decides WHAT TO ASK THE ENGINE for each buffer edit -- nothing else. Pure functions
// (no Svelte, no DOM, no engine calls): diff the buffer against the baseline, pick
// patch / merged insert-delete / full recompile, and assemble the exact TeX to send.
// The same code drives the app and the headless edit-class matrix (tests/live).
import { paraTex, splitParaLines, stripTexComments, wrapHead, wrapItem, type Para } from './splitParas';

export { splitParas, stripTexComments, wrapItem, type Para } from './splitParas';

export function daemonReady(raw: string): boolean {
	const t = stripTexComments(raw);
	let depth = 0;
	let dollars = 0;
	let paren = 0; // \( \) inline math -- unclosed, the engine errors instead of hanging,
	let brack = 0; // but the typeset still fails; route it through repair like $ instead
	for (let i = 0; i < t.length; i++) {
		const c = t[i];
		if (c === '\\') {
			const n = t[i + 1];
			if (n === '(') paren++;
			else if (n === ')') {
				if (--paren < 0) return false;
			} else if (n === '[') brack++;
			else if (n === ']') {
				if (--brack < 0) return false;
			}
			i++; // skip the escaped char: \{ \} \$ \\ aren't grouping
		} else if (c === '{') depth++;
		else if (c === '}') {
			if (--depth < 0) return false;
		} else if (c === '$') dollars++;
	}
	return depth === 0 && dollars % 2 === 0 && paren === 0 && brack === 0;
}
// Mid-typing repair: close still-open math/braces IN NESTING ORDER so the daemon can render
// the partial result instantly ($x + y -> $x + y$; \textbf{par -> \textbf{par}). The closers
// exist only in this transient render, never in the buffer. Null = not repairable (stray
// closers) -> hold the last preview.
export function repairForPreview(raw: string): string | null {
	const stack: string[] = [];
	const t = stripTexComments(raw);
	for (let i = 0; i < t.length; i++) {
		const c = t[i];
		if (c === '\\') {
			const n = t[i + 1];
			if (n === '(') stack.push('\\)');
			else if (n === '[') stack.push('\\]');
			else if (n === ')') {
				if (stack.pop() !== '\\)') return null;
			} else if (n === ']') {
				if (stack.pop() !== '\\]') return null;
			}
			i++;
		} else if (c === '{') stack.push('}');
		else if (c === '}') {
			if (stack.pop() !== '}') return null;
		} else if (c === '$') {
			if (stack[stack.length - 1] === '$') stack.pop();
			else stack.push('$');
		}
	}
	// closers land on their own LINE: appended to the raw text they could fall inside a
	// trailing % comment and vanish
	return stack.length ? raw + '\n' + stack.reverse().join('') : raw;
}

// each buffer minus its paragraph's lines: byte-equal cuts on both sides prove the edit is
// confined to that paragraph. No lexical normalization -- deciding that a comment or a
// blank line is render-inert is the ENGINE's call, so anything else recompiles. Compared
// line-by-line over the shared split arrays (split('\n') lines never contain '\n', so this
// IS join equality) instead of materializing two full-doc cut strings per keystroke.
function cutEq(a: string[], pa: Para, b: string[], pb: Para): boolean {
	const a0 = pa.startLine - 1;
	const an = pa.text.split('\n').length;
	const b0 = pb.startLine - 1;
	const bn = pb.text.split('\n').length;
	const n = a.length - an;
	if (n !== b.length - bn) return false;
	for (let i = 0; i < n; i++) if (a[i < a0 ? i : i + an] !== b[i < b0 ? i : i + bn]) return false;
	return true;
}

// only one baseline is live at a time (it advances when a compile lands), so a single-slot
// memo keyed on the string makes the per-keystroke baseline split + splitParas free -- the
// caller hands back the same string reference until then, so the compare is O(1).
let baseMemo: { src: string; lines: string[]; paras: Para[] } | null = null;
function baselineOf(src: string) {
	if (!baseMemo || baseMemo.src !== src) {
		const lines = src.split('\n');
		baseMemo = { src, lines, paras: splitParaLines(lines) };
	}
	return baseMemo;
}

export type ParaRef = { line: number; endLine: number; text: string; listItem: boolean };
export type PatchAction = {
	line: number;
	endLine: number;
	text: string;
	orig: string;
	transient: boolean;
	floatInner: boolean;
	listItem: boolean;
	// the edit added/removed a TeX command (vs pure prose/argument typing). Commands can
	// carry semantics no glyph-geometry predicate sees (\noindent, \color, \setlength,
	// user macros), so such a patch renders instantly but must reconcile to certify --
	// silent drift is worse than a recompile. Our own \par joiner is exempt.
	cmdChanged: boolean;
};
export type EditDecision =
	| { kind: 'noop' }
	// a boundary line (\label, \title, \chapter, \caption, \input, ...) changed
	| { kind: 'boundary' }
	// mid-command state that can't be repaired: hold the preview, wait for the next keystroke
	| { kind: 'skip-unbalanced'; line: number }
	// the paragraph is a non-list env BODY: not a standalone typeset unit
	| { kind: 'env-body'; env: string; line: number }
	// heavier change -> debounced full recompile; focus registers the first diverging
	// block. Inserted/deleted paragraphs that CAN render instantly ride the merged-patch
	// path (prev + \par + run typeset as ONE engine unit, so indent and spacing are the
	// engine's); everything else takes the honest full pass -- there is no JS-placed
	// splice fallback.
	| {
			kind: 'structural';
			reason: 'para-count' | 'multi-para' | 'para+boundary';
			focus: ParaRef | null;
	  }
	// exactly one block changed: dispatch to the instant path
	| ({ kind: 'patch' } & PatchAction);

function refOf(p: Para): ParaRef {
	return {
		line: p.startLine,
		endLine: p.startLine + p.text.split('\n').length - 1,
		text: paraTex(p),
		listItem: !!p.wrap || !!p.env || !!p.head
	};
}

/** ONE decision point per edit: diff the buffer against the last-compiled baseline. */
export function decideEdit(baseline: string, src: string): EditDecision {
	const base = baselineOf(baseline);
	const oldP = base.paras;
	const srcLines = src.split('\n');
	const newP = splitParaLines(srcLines);
	let single = -1;
	if (oldP.length === newP.length) {
		const changed: number[] = [];
		for (let i = 0; i < newP.length; i++) if (newP[i].text !== oldP[i].text) changed.push(i);
		// every paragraph identical: only a byte-identical buffer is a no-op. Whether a
		// comment or blank-line change renders the same is the ENGINE's call -> recompile.
		if (changed.length === 0) return src !== baseline ? { kind: 'boundary' } : { kind: 'noop' };
		// exactly one paragraph changed AND the rest of the buffer is byte-untouched ->
		// instant path. A boundary line changing alongside (a \label edited after an
		// unreconciled patch left the baseline behind) must recompile.
		if (changed.length === 1) {
			if (cutEq(srcLines, newP[changed[0]], base.lines, oldP[changed[0]])) single = changed[0];
			else return structuralOf(base.lines, oldP, newP, 'para+boundary');
		}
	}
	if (single < 0) return structuralOf(base.lines, oldP, newP, oldP.length !== newP.length ? 'para-count' : 'multi-para');
	return buildPatch(base.lines, oldP[single], newP[single]);
}

// the full \caption[short]{...} by brace count: real captions nest ({\tt {\small ...}})
// deeper than any fixed-depth regex reaches
function captionOf(s: string): string | null {
	const at = s.search(/\\caption\*?\s*[[{]/);
	if (at < 0) return null;
	let i = s.indexOf('{', at);
	const br = s.indexOf('[', at);
	if (br >= 0 && br < i) {
		const close = s.indexOf(']', br);
		if (close < 0) return null;
		i = s.indexOf('{', close);
		if (i < 0) return null;
	}
	let depth = 0;
	for (let j = i; j < s.length; j++) {
		const c = s[j];
		if (c === '\\') j++;
		else if (c === '{') depth++;
		else if (c === '}' && --depth === 0) return s.slice(at, j + 1);
	}
	return null;
}

// The single-block instant dispatch for a (baseline, edited) paragraph pair. Also used by
// the compound structural path: an exact patch never advances the baseline, so the routine
// "type in a paragraph, then open a new one" reads as modified+inserted -- the modified
// pair goes through here while the insert splices provisionally.
function buildPatch(baseLines: string[], oP: Para, nP: Para): EditDecision {
	// a preamble block (above \begin{document}) parses as prose but typesets nothing a
	// band could match: route it straight to the boundary pass instead of a doomed
	// patch -> abandon round trip
	const docAt = baseLines.findIndex((l) => /^\s*\\begin\{document\}/.test(l)) + 1;
	if (docAt > 0 && oP.startLine <= docAt) return { kind: 'boundary' };
	// text ships VERBATIM (comments, line structure): the engine's catcodes decide what
	// they mean. Mid-command (unbalanced braces / open math): raw dispatch would hang the
	// daemon. REPAIR the transient text (auto-close open math/groups) so partial math
	// renders live while typing; the repaired edit is transient (may patch or hold, never
	// compile).
	let sendText = nP.text;
	let transient = false;
	if (!daemonReady(sendText)) {
		const rep = repairForPreview(sendText);
		if (rep === null || !daemonReady(rep)) return { kind: 'skip-unbalanced', line: oP.startLine };
		sendText = rep;
		transient = true;
	}
	// A paragraph that is the BODY of a non-list environment (equation, tabular, align...) is
	// not a standalone typeset unit: the daemon error-recovers it into something with the same
	// glyphs but the wrong layout. Lists are fine (wrapItem re-wraps them).
	{
		let pl = oP.startLine - 2; // line above the paragraph, 0-based
		while (pl >= 0 && baseLines[pl].trim() === '') pl--;
		// document/frame are exempt: text after \begin{document} or inside a beamer frame is
		// ordinary prose, not an env body
		const env = pl >= 0 ? baseLines[pl].match(/^\s*\\begin\{([a-zA-Z*]+)\}/) : null;
		if (env && !['itemize', 'enumerate', 'description', 'document', 'frame'].includes(env[1]))
			return { kind: 'env-body', env: env[1], line: oP.startLine };
	}
	// A cell edit inside a FLOATED table can't typeset the whole float (the daemon discards
	// float material), but the inner tabular alone typesets fine: dispatch just the tabular
	// when the change is confined to it. Caption/placement edits keep the whole-block
	// dispatch, which cal-empties into the full pass.
	let dispatchText = wrapHead(wrapItem(sendText, nP.wrap), nP.head);
	let dispatchOrig = paraTex(oP);
	let floatInner = false;
	if (nP.env && /^(table|figure)\*?$/.test(nP.env)) {
		const TAB = /\\begin\{(tabular\*?|tabularx|array)\}[\s\S]*?\\end\{\1\}/;
		const oSub = dispatchOrig.match(TAB)?.[0] ?? null;
		const nSub = dispatchText.match(TAB)?.[0] ?? null;
		if (oSub && nSub && dispatchOrig.replace(oSub, ' ') === dispatchText.replace(nSub, ' ')) {
			// the float body's alignment declaration governs the tabular's x position: ship it
			// too, so the daemon's records carry the true (re)centered offsets instead of a
			// flush-left box the splice would anchor at the column margin
			const before = dispatchOrig.slice(0, dispatchOrig.indexOf(oSub));
			const align = before.match(/\\(?:centering|raggedleft|raggedright)(?![a-zA-Z])/g)?.pop() ?? '';
			dispatchText = align + nSub;
			dispatchOrig = align + oSub;
			floatInner = true;
		}
		// a \caption edit: typeset JUST the caption (float material cal-empties). \@captype is
		// what \caption reads to know its float type; the counter pin makes the daemon's number
		// deterministic ("Figure 1") -- the real number rides the fuzzy tier into a provisional
		// patch and the reconcile paints it, same as section numbers.
		if (!floatInner) {
			const oCap = captionOf(dispatchOrig);
			const nCap = captionOf(dispatchText);
			if (oCap && nCap && dispatchOrig.replace(oCap, ' ') === dispatchText.replace(nCap, ' ')) {
				const type = nP.env.replace('*', '');
				const pin = `\\makeatletter\\def\\@captype{${type}}\\makeatother\\setcounter{${type}}{0}`;
				dispatchText = pin + nCap;
				dispatchOrig = pin + oCap;
				floatInner = true;
			}
		}
	}
	// footnote counter pin: FIXED value like the heading pins -- the engine's own counter
	// accumulates across requests, so a pin is needed purely for determinism. The (likely
	// wrong) mark digit fails exact verification and the patch rides the provisional tier;
	// the reconcile paints the true number. (A JS re-count of earlier \footnote marks used
	// to guess the real value: deleted -- that's TeX counter state reconstructed in JS.)
	const FN = /\\footnote(?:mark)?\s*[[{]/;
	if (FN.test(dispatchText) || FN.test(dispatchOrig)) {
		dispatchText = '\\setcounter{footnote}{0}' + dispatchText;
		dispatchOrig = '\\setcounter{footnote}{0}' + dispatchOrig;
	}
	function cmdsOf(s: string) {
		return (s.match(/\\[a-zA-Z@]+/g) || [])
			.filter((c) => c !== '\\par')
			.sort()
			.join(' ');
	}
	return {
		kind: 'patch',
		line: oP.startLine,
		endLine: oP.startLine + oP.text.split('\n').length - 1,
		text: dispatchText,
		orig: dispatchOrig,
		transient,
		floatInner,
		// env blocks and headings ride the listItem pathway: paraLeft = column left (their
		// records carry their own centering/indent) and no \parindent calibration variant
		listItem: !!nP.wrap || !!nP.env || !!nP.head,
		cmdChanged: cmdsOf(sendText) !== cmdsOf(stripTexComments(oP.text))
	};
}

function structuralOf(
	baseLines: string[],
	oldP: Para[],
	newP: Para[],
	reason: 'para-count' | 'multi-para' | 'para+boundary'
): EditDecision {
	let fi = 0;
	const minLen = Math.min(oldP.length, newP.length);
	while (fi < minLen && oldP[fi].text === newP[fi].text) fi++;
	let bi = 0;
	while (bi < minLen - fi && oldP[oldP.length - 1 - bi].text === newP[newP.length - 1 - bi].text) bi++;
	const t = newP[Math.min(fi, newP.length - 1)];
	const out: EditDecision = { kind: 'structural', reason, focus: t ? refOf(t) : null };
	// shared-prefix + shared-suffix length: which unmatched paragraph is the EDIT of which
	function sim(a: Para, b: Para) {
		const x = a.text;
		const y = b.text;
		const n = Math.min(x.length, y.length);
		let p = 0;
		while (p < n && x[p] === y[p]) p++;
		let s = 0;
		while (s < n - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
		return p + s;
	}
	function plainProse(p: Para) {
		return !p.head && !p.wrap && !p.env;
	}
	// a merge anchor must live in the BODY: a preamble "paragraph" (\documentclass,
	// \newcommand runs) parses as prose but typesets nothing a band could match
	const bodyAt = baseLines.findIndex((l) => /^\s*\\begin\{document\}/.test(l)) + 1;
	function inBody(p: Para) {
		return bodyAt <= 0 || p.startLine > bodyAt;
	}
	// a block the merged-patch path can carry: plain prose, a display heading, or a whole
	// non-float environment (the daemon typesets complete envs; floats it discards, and a
	// list item re-wrapped with an appended \par would render INSIDE the list). Nothing
	// here decides layout -- it only gates WHAT rides one engine typeset.
	function mergeable(p: Para) {
		return inBody(p) && (plainProse(p) || !!p.head || (!!p.env && !/^(table|figure)\*?$/.test(p.env) && !p.wrap));
	}
	// an unclosed \begin{env} swallows the buffer tail into one block; typesetting that
	// (with \end{document} inside) can never render -- hold it back from the merged run.
	// Repairable mid-typing states ($x + y, \section{Op) DO ride: buildPatch repairs the
	// merged text and marks it transient, so partial math renders live while being typed.
	function insertable(p: Para) {
		return mergeable(p) && (daemonReady(p.text) || repairForPreview(p.text) !== null) && !/\\end\{document\}/.test(p.text);
	}
	// Alignment scan: try every insert (or delete) position j inside the unmatched window and
	// accept it when the rest of the window agrees except AT MOST ONE modified pair -- the
	// pending-patch paragraph that never advanced the baseline (the normal state
	// mid-writing). Among valid alignments prefer no-modification, then the pairing whose
	// modified texts are most similar (a transposed pairing would splice swapped content).
	// `short` = the side without the extra paragraphs, `long` = with them; j indexes the
	// start of the inserted/deleted RUN of length k in LONG, mod the modified one in SHORT.
	type Align = { j: number; mod: number | null; score: number };
	function scan(ins: boolean, k: number): Align | null {
		const short = ins ? oldP : newP;
		const long = ins ? newP : oldP;
		let best: Align | null = null;
		for (let j = fi; j <= long.length - k - bi; j++) {
			let mod: number | null = null;
			let ok = true;
			for (let i = fi; i <= short.length - 1 - bi && ok; i++) {
				const li = i < j ? i : i + k;
				if (short[i].text !== long[li].text) {
					if (mod !== null) ok = false;
					else mod = i;
				}
			}
			if (!ok) continue;
			const score = mod === null ? Infinity : sim(short[mod], long[mod < j ? mod : mod + k]);
			if (!best || score > best.score) best = { j, mod, score };
		}
		return best;
	}
	// a run of list items rides its neighbouring item as ONE re-wrapped list typeset; the
	// pinned counter makes labels deterministic-but-wrong, so the patch is provisional and
	// the reconcile paints the truth (nested lists included: a wrong label just fails
	// verification, same as any other uncertified render)
	function itemRun(run: Para[], anchor: Para | null) {
		return !!anchor?.wrap && run.every((p) => p.wrap === anchor.wrap && (daemonReady(p.text) || repairForPreview(p.text) !== null));
	}
	function joinItems(a: Para, run: Para[]) {
		return `${a.text}\n\\item ${run.map((p) => p.text).join('\n\\item ')}`;
	}
	const k = newP.length - oldP.length;
	if (k >= 1 && k <= 6) {
		// typing routinely runs SEVERAL paragraphs ahead of the last landed reconcile (each
		// reconcile takes seconds); a contiguous run of k new paragraphs -- optionally right
		// after a pending-edit paragraph -- is still ONE region. It renders ONLY by riding
		// the previous block as one engine typeset (prev + \par + run): TeX then supplies
		// the indent and the inter-paragraph spacing. No JS-placed splice fallback exists;
		// anything the merged unit can't carry takes the honest full pass.
		const a = scan(true, k);
		if (a) {
			const run = newP.slice(a.j, a.j + k);
			// mergeable, not plain prose: a freshly TYPED heading or env must ride the merged
			// unit too (typing from scratch is headings + prose), rendering provisionally when
			// its number is off. What the engine can't certify still falls to the full pass.
			const runProse = run.every(insertable);
			const joined = run.map((p) => p.text).join('\n\\par ');
			if (a.mod === null) {
				const prev = a.j > 0 ? oldP[a.j - 1] : null;
				if (prev && itemRun(run, prev)) {
					const merged: Para = { ...prev, text: joinItems(prev, run) };
					const one = buildPatch(baseLines, prev, merged);
					if (one.kind === 'patch') return one;
				}
				if (prev && runProse && mergeable(prev)) {
					const merged: Para = { ...prev, text: `${prev.text}\n\\par ${joined}` };
					const one = buildPatch(baseLines, prev, merged);
					if (one.kind === 'patch') return one;
				}
				// no previous block to ride (top of document) or an unmergeable one (a float):
				// ride the NEXT block instead -- run + \par + next as one typeset over the next
				// block's band, which the new content pushes down
				const nxt = a.j < oldP.length ? oldP[a.j] : null;
				if (nxt && runProse && mergeable(nxt) && (!prev || !mergeable(prev))) {
					const merged: Para = { ...nxt, text: `${joined}\n\\par ${nxt.text}` };
					const one = buildPatch(baseLines, nxt, merged);
					if (one.kind === 'patch') return one;
				}
			} else if (a.mod === a.j - 1) {
				// pending edit directly followed by the new run: one merged patch over the
				// modified paragraph's band (two separate splices alternated visually)
				const modOld = oldP[a.mod];
				const modNew = newP[a.mod];
				// mergeable pair, not prose-only: mid-typing a heading the pending pair is
				// "\sect" -> "\section{...", and prose typed after it must not go structural
				if (mergeable(modOld) && insertable(modNew) && runProse) {
					const merged: Para = { ...modNew, text: `${modNew.text}\n\\par ${joined}` };
					const one = buildPatch(baseLines, modOld, merged);
					if (one.kind === 'patch') return one;
				}
			}
		}
	} else if (k <= -1 && k >= -6) {
		// deletions ride the same merged unit in reverse: orig = prev + \par + the removed
		// run (all still on the page, so the band locates), text = prev alone -- the engine
		// computes the closed-up height. Delete + pending edit stays a full pass.
		const kd = -k;
		const a = scan(false, kd);
		if (a && a.mod === null) {
			const gone = oldP.slice(a.j, a.j + kd);
			const prev = a.j > 0 ? oldP[a.j - 1] : null;
			if (prev && itemRun(gone, prev)) {
				const mergedOrig: Para = { ...prev, text: joinItems(prev, gone) };
				const one = buildPatch(baseLines, mergedOrig, prev);
				if (one.kind === 'patch') return one;
			}
			if (prev && mergeable(prev) && gone.every((p) => mergeable(p) || (plainProse(p) && daemonReady(p.text)))) {
				const mergedOrig: Para = { ...prev, text: `${prev.text}\n\\par ${gone.map((p) => p.text).join('\n\\par ')}` };
				const one = buildPatch(baseLines, mergedOrig, prev);
				if (one.kind === 'patch') return one;
			}
			// deleted from the top (or from under a float): close up against the NEXT block
			const nxt = a.j + kd < oldP.length ? oldP[a.j + kd] : null;
			if (
				nxt &&
				mergeable(nxt) &&
				(!prev || !mergeable(prev)) &&
				gone.every((p) => mergeable(p) || (plainProse(p) && daemonReady(p.text)))
			) {
				const mergedOrig: Para = { ...nxt, text: `${gone.map((p) => p.text).join('\n\\par ')}\n\\par ${nxt.text}` };
				const one = buildPatch(baseLines, mergedOrig, nxt);
				if (one.kind === 'patch') return one;
			}
		}
	}
	return out;
}
