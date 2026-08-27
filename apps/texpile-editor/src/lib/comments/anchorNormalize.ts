// the dialect-aware canonicalizer: strips markup so a rendered-side quote and the marked-up
// source meet in one comparable form, with a map back to raw offsets
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
	function emit(ch: string, at: number) {
		if (ch === ' ' && text.endsWith(' ')) return;
		text += ch;
		map.push(at);
	}
	const tex = dialect === 'tex';
	const md = dialect === 'md';
	const typ = dialect === 'typ';
	// nothing but indentation between `i` and the previous newline: line-start markers only
	function atLineStart(i: number) {
		let k = i - 1;
		while (k >= 0 && (s[k] === ' ' || s[k] === '\t')) k--;
		return k < 0 || s[k] === '\n';
	}
	function isLetter(c: string | undefined) {
		return c !== undefined && /[a-zA-Z]/.test(c);
	}
	// md/typ escape any ASCII punctuation; the rendered side holds the bare character
	function isPunct(c: string | undefined) {
		return c !== undefined && /[!-/:-@[-`{-~]/.test(c);
	}
	// the last comparison is U+00A0 (nbsp), not a second plain space: the rendered side of ~
	function ws(c: string) {
		return c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ' ';
	}
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
