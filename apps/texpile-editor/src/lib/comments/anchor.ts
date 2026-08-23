// Where a comment is attached, in a form that survives the file being edited by something that
// is not this app.
//
// Overleaf never needs this: it owns the document store, so every edit passes through its ranges
// tracker and an offset can never go stale. Our files sit on disk. Someone edits main.tex in vim,
// or pulls a branch, and every offset after the change is wrong - silently, which is the bad kind.
// So an offset is only ever a HINT here, and the quote plus its surrounding context is what the
// comment is really pinned to. This is the W3C Web Annotation TextQuoteSelector model, the same
// thing Hypothesis anchors highlights with.
//
// Inside a live editing session none of this runs: CodeMirror maps the decorations through each
// transaction, which is exact and free. Re-anchoring happens on load, and after an external
// change to the file.

/** how much text either side is kept, to tell repeated quotes apart */
const CONTEXT = 32;

/**
 * A quote long enough to be worth searching for. A one- or two-character quote appears everywhere
 * and its context decides the match on its own, which is guesswork dressed up as a result.
 */
const MIN_QUOTE = 3;

/** a runaway scan guard: past this many hits the quote is not distinctive enough to place */
const MAX_HITS = 500;

export type CommentAnchor = {
	/** the commented text itself */
	quote: string;
	/** text immediately before and after it, used to pick between repeats of the quote */
	prefix: string;
	suffix: string;
	/** where the quote sat when the comment was written; re-checked, never trusted */
	start: number;
	end: number;
};

export type ResolvedAnchor = {
	from: number;
	to: number;
	/** the offsets were still right - nothing has moved under this comment */
	exact: boolean;
};

export function buildAnchor(text: string, from: number, to: number): CommentAnchor {
	return {
		quote: text.slice(from, to),
		prefix: text.slice(Math.max(0, from - CONTEXT), from),
		suffix: text.slice(to, Math.min(text.length, to + CONTEXT)),
		start: from,
		end: to
	};
}

/**
 * Find the anchor in `text`, or null if it has gone.
 *
 * Null means orphaned, and an orphaned comment must be SHOWN as orphaned rather than pinned to a
 * best guess: a review note parked on the wrong sentence is worse than one that admits it lost its
 * place, because the reader has no way to tell it is lying.
 */
export function resolveAnchor(text: string, a: CommentAnchor): ResolvedAnchor | null {
	if (a.quote.length < MIN_QUOTE) return null;
	// the common case by far - the file has not been touched behind our back
	if (text.slice(a.start, a.end) === a.quote) return { from: a.start, to: a.end, exact: true };
	const hit = searchQuote(text, a.quote, a.prefix, a.suffix, a.start);
	return hit ? { ...hit, exact: false } : null;
}

/** the search behind resolveAnchor, shared with the loose path; `hint` breaks exact-score ties */
function searchQuote(text: string, quote: string, prefix: string, suffix: string, hint: number): { from: number; to: number } | null {
	if (quote.length < MIN_QUOTE) return null;
	const hits = occurrences(text, quote);
	if (hits.length === 0) return null;
	// Too common to place. The scan stops at MAX_HITS, so scoring what it collected would rank the
	// first 500 copies and ignore the rest - and a comment on `\begin` in a long document would land
	// confidently near the top of the file, which is precisely the lie this module exists to avoid.
	// Orphaned is the honest answer for a quote this repetitive.
	if (hits.length >= MAX_HITS) return null;
	if (hits.length === 1) return { from: hits[0], to: hits[0] + quote.length };

	// repeated quote: the context decides. Ties go to whichever copy is nearest where the comment
	// used to be, since edits move text a little more often than they move it a long way.
	const a = { quote, prefix, suffix };
	let best = hits[0];
	let bestScore = -1;
	for (const at of hits) {
		const score = contextScore(text, at, at + quote.length, a);
		if (score > bestScore || (score === bestScore && Math.abs(at - hint) < Math.abs(best - hint))) {
			bestScore = score;
			best = at;
		}
	}
	return { from: best, to: best + quote.length };
}

/** which markup family the normalizer strips; derived from the commented file, never stored */
export type AnchorDialect = 'tex' | 'md' | 'typ';

/** the anchor dialect of a workspace file, by extension; anything unknown matches as LaTeX */
export function dialectOfPath(path: string): AnchorDialect {
	const p = path.toLowerCase();
	if (p.endsWith('.md') || p.endsWith('.markdown')) return 'md';
	if (p.endsWith('.typ')) return 'typ';
	return 'tex';
}

/**
 * Bring both dialects of the same prose to one canonical form, remembering where every canonical
 * character came from: map[i] = raw offset where canonical character i starts. (The raw span of
 * character i therefore ends where character i+1 begins.)
 *
 * The layers are deliberately closed sets - whitespace, escapes, the typographic ligatures, and
 * per-dialect INLINE MARKERS (md/typ emphasis and code marks, link syntax, line-start list and
 * heading markers; tex braces and \word commands) - because each is deterministic enough to apply
 * to BOTH sides of a match. Stripping is symmetric: the same characters vanish from the quote and
 * the haystack, so a rendered-dialect quote and the marked-up source meet in the middle. What is
 * NOT here is anything whose text differs between the two sides (math bodies, citation chips,
 * link targets): a quote crossing those demotes to its block instead of being matched by
 * machinery we only half trust.
 */
export function normalizeForMatch(s: string, dialect: AnchorDialect = 'tex'): { text: string; map: number[] } {
	const map: number[] = [];
	let text = '';
	// consecutive spaces collapse IN THE CANONICAL TEXT, not just in the raw scan: a dropped
	// token between two whitespace runs ("a | b", "{ }") would otherwise leave a double space on
	// one side of the match and a single on the other
	const emit = (ch: string, at: number) => {
		if (ch === ' ' && text.endsWith(' ')) return;
		text += ch;
		map.push(at);
	};
	const tex = dialect === 'tex';
	const md = dialect === 'md';
	const typ = dialect === 'typ';
	// nothing but indentation between `i` and the previous newline: line-start markers only
	const atLineStart = (i: number) => {
		let k = i - 1;
		while (k >= 0 && (s[k] === ' ' || s[k] === '\t')) k--;
		return k < 0 || s[k] === '\n';
	};
	const isLetter = (c: string | undefined) => c !== undefined && /[a-zA-Z]/.test(c);
	// md/typ escape any ASCII punctuation; the rendered side holds the bare character
	const isPunct = (c: string | undefined) => c !== undefined && /[!-/:-@[-`{-~]/.test(c);
	// the last comparison is U+00A0 (nbsp), not a second plain space: the rendered side of ~
	const ws = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ' ';
	for (let i = 0; i < s.length;) {
		const c = s[i];
		// line-start structure markers vanish: the rendered side has heading/list NODES, no marker
		// characters. Symmetric by absence - the rendered text never contains them to begin with.
		if ((md || typ) && atLineStart(i)) {
			if (md && c === '#') {
				let j = i;
				while (s[j] === '#' && j - i < 6) j++;
				if (s[j] === ' ' || s[j] === '\t') {
					i = j + 1;
					continue;
				}
			}
			if (typ && c === '=') {
				let j = i;
				while (s[j] === '=') j++;
				if (s[j] === ' ' || s[j] === '\t') {
					i = j + 1;
					continue;
				}
			}
			if (md && c === '>') {
				i += s[i + 1] === ' ' ? 2 : 1;
				continue;
			}
			// whole lines that are pure structure - a setext underline (===/---), a thematic
			// break, a table separator row (|:---|---:|) - render as nothing at all
			if (md && (c === '=' || c === '-' || c === '|' || c === ':')) {
				let j = i;
				let dashes = 0;
				while (j < s.length && s[j] !== '\n' && ' \t|:-='.includes(s[j])) {
					if (s[j] === '-' || s[j] === '=') dashes++;
					j++;
				}
				if ((j >= s.length || s[j] === '\n') && dashes >= 2) {
					i = j;
					continue;
				}
			}
			if ((c === '-' || c === '+' || (md && c === '*') || (typ && c === '/')) && (s[i + 1] === ' ' || s[i + 1] === '\t')) {
				i += 2;
				// a task checkbox rides the bullet: its box is a widget on the rendered side
				if (md && s[i] === '[' && (s[i + 1] === ' ' || s[i + 1] === 'x' || s[i + 1] === 'X') && s[i + 2] === ']') {
					i += 3;
					if (s[i] === ' ') i++;
				}
				continue;
			}
			if (md && c >= '0' && c <= '9') {
				let j = i;
				while (s[j] >= '0' && s[j] <= '9') j++;
				if ((s[j] === '.' || s[j] === ')') && (s[j + 1] === ' ' || s[j + 1] === '\t')) {
					i = j + 2;
					continue;
				}
			}
		}
		// whitespace runs to one space: source wraps lines that the rendered text does not, so this
		// single rule is what lets any multi-line quote match at all
		if (ws(c)) {
			const at = i;
			while (i < s.length && ws(s[i])) i++;
			emit(' ', at);
			continue;
		}
		if (c === '~') {
			if (tex || typ) {
				emit(' ', i++); // the non-breaking space; the rendered side is caught by ws above
				continue;
			}
			if (s[i + 1] === '~') {
				i += 2; // md strikethrough marker
				continue;
			}
			emit(c, i++);
			continue;
		}
		if (c === '\\') {
			const next = s[i + 1];
			if (tex) {
				// escaped braces drop like their raw twins below (the rendered side holds bare
				// braces, which the brace rule strips); the other escapes emit their character
				if (next === '{' || next === '}') {
					i += 2;
					continue;
				}
				if (next !== undefined && '&%$#_'.includes(next)) {
					emit(next, i);
					i += 2;
					continue;
				}
				const dots = s.startsWith('\\ldots', i) ? 6 : s.startsWith('\\dots', i) ? 5 : 0;
				if (dots) {
					emit('…', i);
					i += dots;
					continue;
				}
				// any other \word command drops: its ARGUMENT is the prose the rendered side shows
				// (\emph{x} -> x once the braces below go too). \href additionally drops its URL
				// argument, whose text the rendered side never shows. A command whose argument is
				// not prose (\cite, \label) leaves residue that simply fails to match - honest.
				if (isLetter(next)) {
					const cmd = i;
					i++;
					while (isLetter(s[i])) i++;
					if (s[i] === '*') i++;
					if (s.slice(cmd, i) === '\\href' && s[i] === '{') {
						const close = s.indexOf('}', i + 1);
						if (close !== -1 && close - i < 2048) i = close + 1;
					}
					continue;
				}
			} else if (isPunct(next)) {
				// md/typ backslash escape: the rendered side holds the bare character - except the
				// characters each dialect drops outright below, which must vanish escaped or not
				// (the raw twin on the rendered side is dropped by the marker rules, so emitting
				// the escaped one here would leave the two sides unequal). `\\` renders as a lone
				// backslash, which the rendered side swallows as an escape prefix - drop both.
				if ((md && '*_`[]|<>\\'.includes(next)) || (typ && '*_`[]#\\'.includes(next))) {
					i += 2;
					continue;
				}
				emit(next, i);
				i += 2;
				continue;
			}
			if (md || typ) {
				i++; // a stray backslash renders as nothing (line-break backslash included)
				continue;
			}
			emit(c, i++);
			continue;
		}
		// a closed set of HTML entities markdown renders as plain characters; anything else stays
		// literal and simply fails to match (the block fallback carries it)
		if (md && c === '&') {
			const ent = /^&(amp|lt|gt|quot|apos|#39|nbsp|copy|reg|mdash|ndash|hellip|times|deg);/.exec(s.slice(i, i + 8));
			if (ent) {
				const ch = {
					amp: '&',
					lt: '',
					gt: '',
					quot: '"',
					apos: "'",
					'#39': "'",
					nbsp: ' ',
					copy: '©',
					reg: '®',
					mdash: '—',
					ndash: '–',
					hellip: '…',
					times: '×',
					deg: '°'
				}[ent[1]];
				if (ch) emit(ch, i);
				i += ent[0].length;
				continue;
			}
		}
		// dashes and ellipsis canonicalize UP to the unicode character the visual editor's input
		// rules produce; quotes canonicalize DOWN to ascii, because the rendered side may hold
		// either straight or curly depending on whether smartQuotes saw them typed
		if ((tex || typ) && c === '-' && s[i + 1] === '-') {
			const three = s[i + 2] === '-';
			emit(three ? '—' : '–', i);
			i += three ? 3 : 2;
			continue;
		}
		if ((tex || typ) && c === '.' && s[i + 1] === '.' && s[i + 2] === '.') {
			emit('…', i);
			i += 3;
			continue;
		}
		if (c === '`') {
			if (tex) {
				const two = s[i + 1] === '`';
				emit(two ? '"' : "'", i);
				i += two ? 2 : 1;
			} else {
				i++; // md/typ code marker
			}
			continue;
		}
		if (tex && c === "'" && s[i + 1] === "'") {
			emit('"', i);
			i += 2;
			continue;
		}
		// md/typ inline markers vanish from both sides alike: emphasis asterisks/underscores, and
		// md link brackets (a "](url)" goes whole - the rendered side shows only the link's text).
		// md also drops pipes (table syntax) and angle brackets (autolinks, raw HTML) - dropped on
		// BOTH sides, including their escaped and entity forms above, so the match stays symmetric.
		if ((md || typ) && (c === '*' || c === '_')) {
			i++;
			continue;
		}
		if (md && (c === '|' || c === '<' || c === '>')) {
			i++;
			continue;
		}
		// typst structure that renders as nothing: content-block brackets (#underline[x] shows x),
		// function heads (#underline, #text - their argument lists stay as residue and fall to the
		// block tier), and <labels>
		if (typ && (c === '[' || c === ']')) {
			i++;
			continue;
		}
		if (typ && c === '#') {
			// a function head (#underline, #text) and its parenthesized arguments render as
			// nothing - only the [content] shows, and the bracket rule above uncovers it. A bare
			// hash drops too, matching the rendered side where literal hashes come from \#.
			i++;
			if (isLetter(s[i])) {
				while (isLetter(s[i]) || s[i] === '.' || (s[i] >= '0' && s[i] <= '9') || s[i] === '_') i++;
				if (s[i] === '(') {
					let depth = 0;
					let j = i;
					for (; j < s.length && j - i < 512; j++) {
						if (s[j] === '(') depth++;
						else if (s[j] === ')' && --depth === 0) break;
					}
					if (depth === 0 && s[j] === ')') i = j + 1;
				}
			}
			continue;
		}
		if (typ && c === '<') {
			const m = /^<[a-zA-Z_][\w:.-]*>/.exec(s.slice(i, i + 64));
			if (m) {
				i += m[0].length;
				continue;
			}
		}
		// a closed ATX heading's trailing hashes ("### Title ###") render as nothing
		if (md && c === '#') {
			let j = i;
			while (s[j] === '#') j++;
			let k = j;
			while (s[k] === ' ' || s[k] === '\t') k++;
			if (k >= s.length || s[k] === '\n') {
				i = j;
				continue;
			}
		}
		if (md && c === '[') {
			i++;
			continue;
		}
		if (md && c === ']') {
			// the "](destination)" or "][label]" after a link's text renders as nothing
			if (s[i + 1] === '(') {
				const close = s.indexOf(')', i + 2);
				if (close !== -1 && close - i < 1024) {
					i = close + 1;
					continue;
				}
			}
			if (s[i + 1] === '[') {
				const close = s.indexOf(']', i + 2);
				if (close !== -1 && close - i < 256) {
					i = close + 1;
					continue;
				}
			}
			i++;
			continue;
		}
		if (tex && (c === '{' || c === '}')) {
			i++;
			continue;
		}
		if (c === '‘' || c === '’') {
			emit("'", i++);
			continue;
		}
		if (c === '“' || c === '”') {
			emit('"', i++);
			continue;
		}
		emit(c, i++);
	}
	return { text, map };
}

/**
 * One text, normalized once, ready to be searched by many anchors.
 *
 * Exists because normalizing is the expensive half and the text is the same for every thread in a
 * file: it walks the whole string character by character building a parallel offset map, ~3ms for a
 * 200KB document. Doing that per THREAD made a file with 50 relocated comments cost 150ms instead
 * of 5 - the same work 50 times over, for one answer that never changes.
 */
export type LooseHaystack = {
	/** the original string, so a hit can be mapped back to offsets the caller can use */
	raw: string;
	text: string;
	map: number[];
	/** the dialect the haystack was normalized with; anchors must be normalized to match */
	dialect: AnchorDialect;
};

export function prepareLoose(text: string, dialect: AnchorDialect = 'tex'): LooseHaystack {
	const n = normalizeForMatch(text, dialect);
	return { raw: text, text: n.text, map: n.map, dialect };
}

/**
 * resolveAnchor across dialects: the anchor was written against one form of the text (usually the
 * source file) and is being placed in another (the rendered document), so both sides go through
 * normalizeForMatch and the match happens in canonical space. The result is mapped back to RAW
 * offsets in `h.raw`.
 *
 * Never exact: the raw fast path cannot apply when the offsets belong to a different string. The
 * hint is 0 for the same reason - a source offset points nowhere in particular here, so ties fall
 * to the earliest copy rather than to a number pretending to be relevant.
 *
 * The anchor's own quote/prefix/suffix are still normalized per call, and stay that way: they are
 * at most a sentence and a pair of 32-character windows, and they differ every time.
 */
export function resolveAnchorLooseIn(h: LooseHaystack, a: CommentAnchor): ResolvedAnchor | null {
	const quote = normalizeForMatch(a.quote, h.dialect).text;
	const hit = searchQuote(h.text, quote, normalizeForMatch(a.prefix, h.dialect).text, normalizeForMatch(a.suffix, h.dialect).text, 0);
	if (!hit) return null;
	const from = h.map[hit.from];
	const to = hit.to < h.map.length ? h.map[hit.to] : h.raw.length;
	return { from, to, exact: false };
}

/** the single-anchor form; callers with a list should prepare once and loop resolveAnchorLooseIn */
export function resolveAnchorLoose(text: string, a: CommentAnchor, dialect: AnchorDialect = 'tex'): ResolvedAnchor | null {
	return resolveAnchorLooseIn(prepareLoose(text, dialect), a);
}

/** how many characters of the remembered context still line up around a candidate */
function contextScore(text: string, from: number, to: number, a: Pick<CommentAnchor, 'prefix' | 'suffix'>): number {
	let score = 0;
	const before = text.slice(Math.max(0, from - a.prefix.length), from);
	for (let i = 1; i <= Math.min(before.length, a.prefix.length); i++) {
		if (before[before.length - i] !== a.prefix[a.prefix.length - i]) break;
		score++;
	}
	const after = text.slice(to, to + a.suffix.length);
	for (let i = 0; i < Math.min(after.length, a.suffix.length); i++) {
		if (after[i] !== a.suffix[i]) break;
		score++;
	}
	return score;
}

function occurrences(text: string, needle: string): number[] {
	const out: number[] = [];
	for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
		out.push(at);
		if (out.length >= MAX_HITS) break;
	}
	return out;
}

// ---- block downgrade: locate a quote that cannot be matched whole ----

/**
 * Spans of a quote with no textual counterpart on the other side of the dialect boundary, used to
 * SPLIT the quote into locatable fragments. U+FFFC is the rendered side's atom placeholder; the
 * rest is the source syntax of the same atoms - math, citations, references, labels - per
 * dialect. Closed patterns on purpose: a span these miss just yields a shorter fragment.
 */
const ATOM_SYNTAX: Record<AnchorDialect, string> = {
	tex: '￼|\\$[^$]*\\$|\\\\\\((?:[^\\\\]|\\\\[^)])*?\\\\\\)|\\\\\\[(?:[^\\\\]|\\\\[^\\]])*?\\\\\\]|\\\\[a-zA-Z]+\\*?(?:\\[[^\\]]*\\])?(?:\\{[^{}]*\\})+',
	md: '￼|!\\[[^\\]]*\\]\\([^)]*\\)|`[^`]+`|\\$[^$]*\\$|&#?[a-zA-Z0-9]{2,10};|</?[a-zA-Z][^>\\n]{0,80}>',
	typ: '￼|\\$[^$]*\\$|@[\\w:.-]+|#[a-zA-Z_][\\w.]*(?:\\([^()]*\\))?|<[a-zA-Z_][\\w:.-]*>'
};

/**
 * Find WHERE a quote lives when the quote itself cannot: split it at atom spans AND at block
 * boundaries (the newlines flattenDoc put between blocks), and resolve each fragment with the
 * quote's own surrounding text as context. The newline split is what makes the fallback general:
 * whatever construct broke the whole-quote match, some block of the selection is usually plain
 * enough to place.
 *
 * The result SPANS every fragment that resolved, first hit to last - a selection across three
 * paragraphs downgrades to all three, not just the one its longest piece is in. That trust only
 * holds while the hits land in the quote's own order; out-of-order hits mean some fragment
 * matched a lookalike elsewhere, and then only the longest fragment's hit is believed.
 */
export function resolveFragment(h: LooseHaystack, quote: string): ResolvedAnchor | null {
	const split = new RegExp(ATOM_SYNTAX[h.dialect] + '|\\n+', 'g');
	const frags: { text: string; at: number }[] = [];
	let last = 0;
	for (let m = split.exec(quote); m !== null; m = split.exec(quote)) {
		if (m.index > last) frags.push({ text: quote.slice(last, m.index), at: last });
		last = m.index + (m[0].length || 1);
	}
	if (last < quote.length) frags.push({ text: quote.slice(last), at: last });
	if (frags.length === 1 && frags[0].at === 0 && frags[0].text === quote) return null; // nothing to split: the whole quote already missed
	const resolve = (f: { text: string; at: number }) =>
		resolveAnchorLooseIn(h, {
			quote: f.text,
			prefix: quote.slice(Math.max(0, f.at - CONTEXT), f.at),
			suffix: quote.slice(f.at + f.text.length, f.at + f.text.length + CONTEXT),
			start: 0,
			end: 0
		});
	const hits: ResolvedAnchor[] = [];
	let longest: { hit: ResolvedAnchor; len: number } | null = null;
	for (const f of frags) {
		if (f.text.trim().length < MIN_QUOTE) continue;
		const hit = resolve(f);
		if (!hit) continue;
		hits.push(hit);
		if (!longest || f.text.length > longest.len) longest = { hit, len: f.text.length };
	}
	if (!hits.length) return null;
	const ordered = hits.every((x, i) => i === 0 || x.from >= hits[i - 1].from);
	if (ordered) return { from: hits[0].from, to: Math.max(...hits.map((x) => x.to)), exact: false };
	return longest!.hit;
}

/**
 * The whole creation-time conversion: a rendered-dialect anchor (from a visual editor) becomes a
 * SOURCE-dialect one - precise when the quote survives the dialect boundary, the enclosing block
 * when only a fragment does, unchanged (detached) when nothing at all is locatable. Lives here
 * rather than in the controller so it is a pure function tests can hammer with generated
 * selections.
 */
export function toSourceAnchor(
	text: string,
	dialect: AnchorDialect,
	a: CommentAnchor
): { anchor: CommentAnchor; tier: 'precise' | 'block' | 'detached' } {
	const hay = prepareLoose(text, dialect);
	const hit = resolveAnchor(text, a) ?? resolveAnchorLooseIn(hay, a);
	if (hit) return { anchor: buildAnchor(text, hit.from, hit.to), tier: 'precise' };
	const frag = resolveFragment(hay, a.quote);
	if (frag) {
		const b = blockBounds(text, frag.from, frag.to);
		if (b.to > b.from) return { anchor: buildAnchor(text, b.from, b.to), tier: 'block' };
	}
	return { anchor: a, tier: 'detached' };
}

/**
 * The enclosing source block of a range: expanded to blank-line boundaries, edges trimmed. The
 * unit a fragment-located comment downgrades to - blank lines delimit paragraphs in every dialect
 * this app edits, so the rule needs no parser and cannot lie by much.
 */
export function blockBounds(text: string, from: number, to: number): { from: number; to: number } {
	let start = 0;
	{
		let lineStart = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
		while (lineStart > 0) {
			const prevStart = text.lastIndexOf('\n', lineStart - 2) + 1;
			if (!text.slice(prevStart, lineStart - 1).trim()) {
				start = lineStart;
				break;
			}
			lineStart = prevStart;
		}
	}
	let end = text.length;
	{
		let lineEnd = text.indexOf('\n', to);
		while (lineEnd !== -1) {
			const nextEnd = text.indexOf('\n', lineEnd + 1);
			if (!text.slice(lineEnd + 1, nextEnd === -1 ? text.length : nextEnd).trim()) {
				end = lineEnd;
				break;
			}
			lineEnd = nextEnd;
		}
	}
	while (start < end && /\s/.test(text[start])) start++;
	while (end > start && /\s/.test(text[end - 1])) end--;
	return { from: start, to: end };
}
