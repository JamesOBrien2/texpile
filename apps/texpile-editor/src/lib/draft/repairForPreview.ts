// Whether an edited paragraph is safe to hand the daemon as-is, and the closing repair
// (unbalanced braces, an open math span) that makes a half-typed one previewable.
import { stripTexComments } from './splitParas';

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
