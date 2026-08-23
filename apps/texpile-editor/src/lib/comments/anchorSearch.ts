// exact anchoring: build a quote-plus-context anchor and find it again, ranking candidate
// hits by how much of the remembered context still lines up
/** how much text either side is kept, to tell repeated quotes apart */
export const CONTEXT = 32;

/**
 * A quote long enough to be worth searching for. A one- or two-character quote appears everywhere
 * and its context decides the match on its own, which is guesswork dressed up as a result.
 */
export const MIN_QUOTE = 3;

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
export function searchQuote(
	text: string,
	quote: string,
	prefix: string,
	suffix: string,
	hint: number
): { from: number; to: number } | null {
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
