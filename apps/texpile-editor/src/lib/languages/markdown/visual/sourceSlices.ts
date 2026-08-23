// maps markdown-it's line-based token positions back to source offsets for orig capture
import type { Token } from 'markdown-it';

export type Cap = {
	source: string;
	lineStarts: number[];
	seq: number;
	prevEnd: number;
	group: number;
};

export function buildLineStarts(source: string): number[] {
	const starts = [0];
	for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);
	return starts;
}

export function offsetOfLine(cap: Cap, line: number): number {
	return line < cap.lineStarts.length ? cap.lineStarts[line] : cap.source.length;
}

/** byte just past the construct's last line, excluding that line's own trailing newline (the
 *  newline is inter-block gap and belongs to the next block's `pre`). */
export function sliceEnd(cap: Cap, endLine: number): number {
	const end = offsetOfLine(cap, endLine);
	return end > 0 && cap.source[end - 1] === '\n' ? end - 1 : end;
}

/** index of the token closing the construct opened at `i`; `i` itself for self-closed tokens. */
export function constructEnd(tokens: Token[], i: number): number {
	if (tokens[i].nesting !== 1) return i;
	let depth = 0;
	for (let k = i; k < tokens.length; k++) {
		depth += tokens[k].nesting;
		if (depth === 0) return k;
	}
	return tokens.length - 1; // unbalanced stream: consume to the end rather than loop
}
