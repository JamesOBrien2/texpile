// CST helpers and the inline walker: text, marks, links, shorthands, inline math
import type { SyntaxNode } from '@lezer/common';
import { el, txtNodes, collapseTextNodes, realMarks, type PmNode, type PmMark } from './builders';
import { typstMathToLatex } from './mathTranslate';

export function children(node: SyntaxNode): SyntaxNode[] {
	const out: SyntaxNode[] = [];
	for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
	return out;
}

export function childOf(node: SyntaxNode, name: string): SyntaxNode | null {
	for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) return c;
	return null;
}

// code expressions that are statements: they configure the document or bind names, are
// virtually always written on their own line, and always become their own raw block
export const STATEMENT_KINDS = new Set([
	'ModuleImport',
	'ModuleInclude',
	'LetBinding',
	'SetRule',
	'ShowRule',
	'Conditional',
	'ForLoop',
	'WhileLoop',
	'Contextual',
	'CodeBlock'
]);

// shorthands become the character the reader sees; the reverse direction needs no mapping
// because the character itself is valid Typst text
export const SHORTHANDS: Record<string, string> = {
	'--': '\u2013',
	'---': '\u2014',
	'...': '\u2026',
	'~': '\u00a0',
	'-?': '\u00ad'
};

/** `\*` reveals `*`; `\u{263A}` reveals the code point. Unknown forms stay verbatim. */
export function unescape(slice: string): string {
	const u = /^\\u\{([0-9a-fA-F]+)\}$/.exec(slice);
	if (u) {
		try {
			return String.fromCodePoint(parseInt(u[1], 16));
		} catch {
			return slice;
		}
	}
	return slice.length >= 2 && slice[0] === '\\' ? slice.slice(1) : slice;
}

export function withMarks(node: PmNode, marks: PmMark[]): PmNode {
	return marks.length > 0 ? node.mark(realMarks(marks)) : node;
}

/** an inline raw-source chip; the escape hatch every unknown inline construct falls into. */
export function chip(text: string, marks: PmMark[]): PmNode[] {
	return text ? [withMarks(el('inline_latex', { lang: 'typst' }, txtNodes(text)), marks)] : [];
}

export function rawBlock(text: string): PmNode {
	return el('raw_latex', { lang: 'typst' }, txtNodes(text));
}

/** the source between an Equation's dollar delimiters, exactly as written. */
export function equationInner(eq: SyntaxNode, src: string): string {
	const ds = children(eq).filter((c) => c.name === 'Dollar');
	if (ds.length >= 2) return src.slice(ds[0].to, ds[ds.length - 1].from);
	return src.slice(eq.from, eq.to).replace(/^\$|\$$/g, '');
}

/** typst string literal -> its value; only the escapes a URL plausibly contains. */
export function unquote(str: string): string {
	const inner = str.startsWith('"') && str.endsWith('"') && str.length >= 2 ? str.slice(1, -1) : str;
	return inner.replace(/\\(["\\])/g, '$1');
}

/** `#link("...")[...]` and nothing fancier; any other shape stays a chip. */
export function linkParts(call: SyntaxNode, src: string): { href: string; markup: SyntaxNode } | null {
	if (call.name !== 'FuncCall') return null;
	const ident = call.firstChild;
	if (!ident || ident.name !== 'Ident' || src.slice(ident.from, ident.to) !== 'link') return null;
	const args = ident.nextSibling;
	if (!args || args.name !== 'Args') return null;
	const real = children(args).filter((k) => !['LeftParen', 'RightParen', 'Comma', 'Space'].includes(k.name));
	if (real.length !== 2 || real[0].name !== 'Str' || real[1].name !== 'ContentBlock') return null;
	const markup = childOf(real[1], 'Markup');
	if (!markup) return null;
	return { href: unquote(src.slice(real[0].from, real[0].to)), markup };
}

/** typst named colors that CSS can also render - the mark's DOM styling uses the value directly.
 *  `eastern` exists in typst but not CSS, so it stays a chip. */
const COLOR_IDENTS = new Set([
	'black',
	'gray',
	'silver',
	'white',
	'navy',
	'blue',
	'aqua',
	'teal',
	'purple',
	'fuchsia',
	'maroon',
	'red',
	'orange',
	'yellow',
	'olive',
	'green',
	'lime'
]);

export const CALL_PUNCT = ['LeftParen', 'RightParen', 'Comma', 'Space'];

/** `rgb("#hex")` or a shared named color -> its CSS-compatible value; anything else null. */
function colorValue(node: SyntaxNode, src: string): string | null {
	if (node.name === 'Ident') {
		const v = src.slice(node.from, node.to);
		return COLOR_IDENTS.has(v) ? v : null;
	}
	if (node.name === 'FuncCall') {
		const id = node.firstChild;
		if (!id || id.name !== 'Ident' || src.slice(id.from, id.to) !== 'rgb') return null;
		const args = id.nextSibling;
		if (!args || args.name !== 'Args') return null;
		const real = children(args).filter((k) => !CALL_PUNCT.includes(k.name));
		if (real.length !== 1 || real[0].name !== 'Str') return null;
		const v = unquote(src.slice(real[0].from, real[0].to)).toLowerCase();
		return /^#[0-9a-f]{3,8}$/.test(v) ? v : null;
	}
	return null;
}

/** the color of a `fill: <color>` named argument, or null for any other named arg. */
function fillColor(named: SyntaxNode, src: string): string | null {
	const kids = children(named).filter((k) => k.name !== 'Colon' && k.name !== 'Space');
	if (kids.length !== 2 || kids[0].name !== 'Ident' || src.slice(kids[0].from, kids[0].to) !== 'fill') return null;
	return colorValue(kids[1], src);
}

const MARK_FUNCS: Record<string, 'u' | 'sup' | 'sub'> = { underline: 'u', super: 'sup', sub: 'sub' };

/** `#underline[..] / #super[..] / #sub[..] / #highlight[..] / #highlight(fill: c)[..] /
 *  #text(fill: c)[..]` -> a mark over the inline content. Any other shape (extra arguments,
 *  unshared color) stays a chip, the same rule links follow. */
export function markCallParts(call: SyntaxNode, src: string): { mark: PmMark; markup: SyntaxNode } | null {
	if (call.name !== 'FuncCall') return null;
	const ident = call.firstChild;
	if (!ident || ident.name !== 'Ident') return null;
	const name = src.slice(ident.from, ident.to);
	const args = ident.nextSibling;
	if (!args || args.name !== 'Args') return null;
	const real = children(args).filter((k) => !CALL_PUNCT.includes(k.name));
	function contentMarkup(n: SyntaxNode | undefined) {
		return n && n.name === 'ContentBlock' ? childOf(n, 'Markup') : null;
	}

	const plain = MARK_FUNCS[name];
	if (plain) {
		if (real.length !== 1) return null;
		const markup = contentMarkup(real[0]);
		return markup ? { mark: { type: plain }, markup } : null;
	}
	if (name === 'highlight') {
		if (real.length === 1) {
			const markup = contentMarkup(real[0]);
			return markup ? { mark: { type: 'highlight', attrs: { color: 'yellow' } }, markup } : null;
		}
		if (real.length === 2 && real[0].name === 'Named') {
			const color = fillColor(real[0], src);
			const markup = contentMarkup(real[1]);
			return color && markup ? { mark: { type: 'highlight', attrs: { color } }, markup } : null;
		}
		return null;
	}
	if (name === 'text' && real.length === 2 && real[0].name === 'Named') {
		const color = fillColor(real[0], src);
		const markup = contentMarkup(real[1]);
		return color && markup ? { mark: { type: 'textcolor', attrs: { color } }, markup } : null;
	}
	return null;
}

/** inline CST nodes -> inline PM nodes. Pairs each Hash with the expression following it. */
export function convertInline(nodes: SyntaxNode[], src: string, marks: PmMark[]): PmNode[] {
	const out: PmNode[] = [];
	for (let i = 0; i < nodes.length; i++) {
		const k = nodes[i];
		const slice = src.slice(k.from, k.to);
		switch (k.name) {
			case 'Text':
				out.push(...txtNodes(slice, marks));
				break;
			case 'Space':
			case 'Parbreak': // only reachable in odd nests; a wrap is semantically a space
				out.push(...txtNodes(' ', marks));
				break;
			case 'Strong':
			case 'Emph': {
				const markup = childOf(k, 'Markup');
				if (markup) {
					out.push(...convertInline(children(markup), src, [...marks, { type: k.name === 'Strong' ? 'strong' : 'em' }]));
				} else {
					out.push(...chip(slice, marks));
				}
				break;
			}
			case 'Raw': {
				const delims = children(k).filter((c) => c.name === 'RawDelim');
				if (delims.length < 2 || delims[0].to - delims[0].from >= 3) {
					// unterminated, or a block fence stuck mid-line: keep it literal
					out.push(...chip(slice, marks));
				} else {
					out.push(...txtNodes(src.slice(delims[0].to, delims[delims.length - 1].from), [...marks, { type: 'code' }]));
				}
				break;
			}
			case 'Linebreak':
				out.push(el('hard_break', { lineBreak: true }));
				// the newline ending the broken line is part of the break, not a leading space
				// on the continuation
				if (nodes[i + 1]?.name === 'Space') i++;
				break;
			case 'Escape':
				out.push(...txtNodes(unescape(slice), marks));
				break;
			case 'SmartQuote':
				out.push(...txtNodes(slice, marks));
				break;
			case 'Shorthand':
				out.push(...txtNodes(SHORTHANDS[slice] ?? slice, marks));
				break;
			case 'Hash': {
				const next = nodes[i + 1];
				if (!next) {
					out.push(...chip('#', marks));
					break;
				}
				const link = linkParts(next, src);
				const markCall = link ? null : markCallParts(next, src);
				if (link) {
					const linkMark: PmMark = { type: 'link', attrs: { href: link.href, title: null, bare: false } };
					out.push(...convertInline(children(link.markup), src, [...marks, linkMark]));
				} else if (markCall) {
					out.push(...convertInline(children(markCall.markup), src, [...marks, markCall.mark]));
				} else {
					out.push(...chip(src.slice(k.from, next.to), marks));
				}
				i++;
				break;
			}
			case 'Equation': {
				// fully-translatable equations become MathLive-editable math nodes carrying their
				// original typst; anything the translator can't prove stays a raw chip
				const latex = typstMathToLatex(k, src);
				if (latex != null) {
					out.push(withMarks(el('inline_math', { typst: equationInner(k, src), latexOrig: latex }, txtNodes(latex)), marks));
				} else {
					out.push(...chip(slice, marks));
				}
				break;
			}
			case 'Ref': {
				// a bare @target becomes the ref/citation atom; a supplement (`@fig[Figure]`) stays
				// a chip - the atom's serializer has no slot for it
				const refKids = children(k);
				if (refKids.length === 1 && refKids[0].name === 'RefMarker') {
					out.push(withMarks(el('typ_ref', { target: slice.slice(1) }), marks));
				} else {
					out.push(...chip(slice, marks));
				}
				break;
			}
			// labels, equations, comments and anything unforeseen: verbatim chips
			default:
				out.push(...chip(slice, marks));
		}
	}
	return collapseTextNodes(out);
}

/** one source construct -> its PM blocks, with the span the slice is cut from. */
