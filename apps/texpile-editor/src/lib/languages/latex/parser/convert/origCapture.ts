// verbatim `orig` capture: source extents, raw-slice recovery, and the capture state the
// top-level block pass consumes (armed by latexToProseMirror)
import type { Node, Macro } from '@unified-latex/unified-latex-types';
import { type PmNode } from '../builders';

export type CaptureHolder = {
	pending: CaptureState | null;
	last: CaptureState | null;
	rawSource: string | null;
};

export const capture: CaptureHolder = { pending: null, last: null, rawSource: null };

export type CaptureState = {
	/** The exact source string the AST positions index into. */
	source: string;
	/** Next top-level block index. EVERY pushed block gets a seq, even span-less ones, so the
	 *  serializer can tell pristine neighbours from a deletion (re-joining across a deletion
	 *  with `pre` would resurrect the deleted source). */
	seq: number;
	/** End offset of the previous block's span (start of the current inter-block gap). */
	prevEnd: number;
	/** Next group id for one-source-construct to many-blocks results. */
	group: number;
};
// stashed by the top-level convertNodesToBlocks right before it returns so latexToProseMirror
// can read the final prevEnd/seq for the body's trailing gap. grab-and-null, like capture.pending.

/** Min/max offsets over `n`'s position (+ content/args), REJECTING any start before `floor`:
 *  never a legitimate undershoot, always a synthetic/corrupt offset (math script groups have no
 *  real position; a missing `.offset` reads back as 0, which a naive `<` would accept and drag
 *  the span to the file start). `floor` is always cap.prevEnd. */
export function extentOf(n: unknown, floor: number): { min: number; max: number } {
	let min = Infinity;
	let max = -Infinity;
	if (!n || typeof n !== 'object') return { min, max };
	const node = n as { position?: { start?: { offset?: number }; end?: { offset?: number } }; content?: unknown; args?: unknown[] };
	const p = node.position;
	if (p) {
		if (typeof p.start?.offset === 'number' && p.start.offset >= floor) min = p.start.offset;
		if (typeof p.end?.offset === 'number') max = p.end.offset;
	}
	for (const kids of [node.content, node.args]) {
		if (!Array.isArray(kids)) continue;
		for (const kid of kids) {
			const e = extentOf(kid, floor);
			min = Math.min(min, e.min);
			max = Math.max(max, e.max);
		}
	}
	return { min, max };
}

/** Min/max source offsets across node + content + attached args. recursing matters:
 *  attachMacroArgs can leave the macro's own position covering only the control sequence while
 *  the moved args carry their own, so extending past the node's own end is intentional. the
 *  node's OWN start, when >= floor, is additionally authoritative for the lower bound. */
export function nodeExtent(node: Node, floor = 0): { min: number; max: number } | null {
	const acc = extentOf(node, floor);
	if (acc.min > acc.max) return null;
	const top = (node as unknown as { position?: { start?: { offset?: number } } }).position;
	if (typeof top?.start?.offset === 'number' && top.start.offset >= floor && acc.min < top.start.offset) acc.min = top.start.offset;
	return acc;
}

/** Recreate `node` with an `orig` attr. Types that don't declare `orig` are returned as-is
 *  (fail-safe: such a block simply always regenerates). */
export function withOrig(node: PmNode, orig: Record<string, unknown>): PmNode {
	if (!node.type.spec.attrs || !('orig' in node.type.spec.attrs)) return node;
	return node.type.create({ ...node.attrs, orig }, node.content, node.marks);
}

// byte-faithful raw fallback: raw preservation slices the ORIGINAL bytes via source offsets
// instead of printRaw. printRaw emits a blank line after own-line comments, and a blank line IS
// a \par token: fatal "Runaway argument" inside a non-\long arg (\author, \institute), a silent
// paragraph break in prose. printRaw stays the fallback for nodes without a trustworthy span
// (synthesized nodes, the slotified figureTemplate tree).

/** Net `{`-minus-`}` depth of `s`, ignoring `\{`/`\}` escapes and `%`-comment tails. */
function braceDebt(s: string): number {
	let depth = 0;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === '\\') {
			i++; // skip the escaped char (covers \{ \} \%)
			continue;
		}
		if (ch === '%') {
			while (i < s.length && s[i] !== '\n') i++;
			continue;
		}
		if (ch === '{') depth++;
		else if (ch === '}') depth--;
	}
	return depth;
}

/**
 * Attached args' brace/bracket delimiters are stripped from the AST (openMark/closeMark
 * metadata, not positioned nodes), so a position-based extent ends just before the final
 * closer(s). reclaim the expected tail from the source: last positioned arg's closeMark, then
 * each later (empty, position-less) arg's marks, whitespace allowed between. returns the
 * repaired end offset, or null when the source disagrees (caller falls back to printRaw).
 */
export function repairArgTail(node: Node, src: string, endIn: number): number | null {
	const args = (node as Macro).args as { openMark: string; closeMark: string; content: Node[] }[] | undefined;
	if (!args || args.length === 0) return endIn;
	let last = -1;
	for (let k = args.length - 1; k >= 0; k--) {
		const maxEnd = Math.max(-Infinity, ...args[k].content.map((c) => extentOf(c, 0).max));
		if (Number.isFinite(maxEnd) && maxEnd > 0) {
			last = k;
			break;
		}
	}
	const expectTail: string[] = [];
	if (last >= 0 && args[last].closeMark) expectTail.push(args[last].closeMark);
	for (let k = last + 1; k < args.length; k++) {
		if (args[k].openMark) expectTail.push(args[k].openMark);
		if (args[k].closeMark) expectTail.push(args[k].closeMark);
	}
	let end = endIn;
	for (const ch of expectTail) {
		// lexical whitespace skip; which closers to expect came from the AST args above
		while (end < src.length && /[ \t\r\n]/.test(src[end])) end++;
		if (src[end] !== ch) return null;
		end++;
	}
	return end;
}

/** The node's exact original source slice, or null when no trustworthy span exists. */
export function nodeRawSource(node: Node): string | null {
	if (!capture.rawSource) return null;
	const ext = nodeExtent(node);
	if (!ext || !Number.isFinite(ext.min) || ext.min < 0 || ext.max > capture.rawSource.length || ext.min >= ext.max) return null;

	let end: number | null = ext.max;
	const hasArgs = !!(node as Macro).args?.length;
	if (hasArgs) {
		end = repairArgTail(node, capture.rawSource, ext.max);
		// the repair can be unnecessary (positions already covered the closers); accept the raw
		// extent instead iff it is brace-balanced on its own.
		if (end == null && braceDebt(capture.rawSource.slice(ext.min, ext.max)) === 0) end = ext.max;
		if (end == null) return null;
	}
	if (end > capture.rawSource.length) return null;

	const slice = capture.rawSource.slice(ext.min, end);
	// every construct sliced here starts with \ or {, and a faithful slice must be
	// brace-balanced: refuse corrupt extents that landed mid-prose.
	if (!/^[\\{]/.test(slice) || braceDebt(slice) !== 0) return null;
	return slice;
}

/**
 * Byte slice of a math container's CONTENT from the container's OWN position, delimiters
 * verified against the source. content-descendant extents aren't trustworthy in math:
 * synthesized script groups default to offset 0, and \frac-style attached args can carry no
 * positions at all (truncating the max, brace-balanced both times so a balance check can't
 * catch it). why slice at all: printRaw re-brackets scripts and seals a script macro away from
 * its trailing argument (`y_\history{i}` becomes `y_{\history}{i}`, a fatal extra-} error).
 * null unless both delimiters match; caller falls back to printRaw.
 */
export function mathBodyRawSource(node: Node, opens: string[], closes: string[]): string | null {
	if (!capture.rawSource) return null;
	const src = capture.rawSource;
	const pos = (node as { position?: { start?: { offset?: number }; end?: { offset?: number } } }).position;
	const start = pos?.start?.offset;
	const end = pos?.end?.offset;
	if (typeof start !== 'number' || typeof end !== 'number' || start < 0 || end > src.length || start >= end) return null;
	const open = opens.find((o) => src.startsWith(o, start));
	const close = closes.find((c) => end - c.length >= start && src.startsWith(c, end - c.length));
	if (!open || !close || start + open.length > end - close.length) return null;
	const slice = src.slice(start + open.length, end - close.length);
	return braceDebt(slice) === 0 ? slice : null;
}

/**
 * Extend ext.max over a macro's attached-arg tail when the source confirms it (repairArgTail).
 * used by the orig block capture: a block ending inside an attached argument otherwise gets a
 * truncated orig.latex, and the missing closer lands in the inter-block gap, silently lost
 * whenever the next block has no verbatim slice to re-join `pre` across.
 */
export function repairExtentTail(node: Node, ext: { min: number; max: number } | null): { min: number; max: number } | null {
	if (!ext || !capture.rawSource || !Number.isFinite(ext.max)) return ext;
	if (!(node as Macro).args?.length) return ext;
	const end = repairArgTail(node, capture.rawSource, ext.max);
	return end != null && end > ext.max ? { min: ext.min, max: end } : ext;
}
