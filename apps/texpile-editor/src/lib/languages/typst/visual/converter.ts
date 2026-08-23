// Typst source -> ProseMirror, over the CST from our own wasm build of typst-syntax
// (packages/typst-syntax-wasm). Max-fidelity contract mirrors the LaTeX and Markdown importers:
// every construct the walker understands becomes a rich node; anything else survives as a raw
// block/chip sliced verbatim from the source, so an unknown node kind can never crash a file
// open or lose bytes. Code mode (#let, #show, #import, function calls...) is deliberately ALL
// raw islands in this phase — the visual editor edits markup structure, source mode edits code.
//
// Verbatim capture is the simplest of the three dialects: the CST carries exact UTF-16 offsets
// on every node, so orig slices come straight off the tree. Typst's tree is flat at the markup
// level (paragraph boundaries are explicit Parbreak nodes, a Hash is a SIBLING of the code
// expression it introduces), so block grouping is synthesized here.
import type { SyntaxNode, Tree } from '@lezer/common';
import { TypstParser } from 'texpile-typst-syntax-wasm';
import { el, txtNodes, type PmNode } from './builders';
import { mergeAdjacentRawBlocks } from '$lib/editor/visual/mergeRawBlocks';
import {
	children,
	childOf,
	rawBlock,
	equationInner,
	convertInline,
	linkParts,
	markCallParts,
	unquote,
	STATEMENT_KINDS
} from './inlineConvert';
import { typstMathToLatex } from './mathTranslate';
import { tableSeg } from './tableConvert';
import { figureSeg } from './figureConvert';
import { headingSeg, listSeg, termSeg, quoteSeg, aloneWithLabel } from './segConvert';

// one parser for the module: Source::replace reparses incrementally against the previous text,
// and the converter has no per-document state of its own
let parser: TypstParser | null = null;
function parseTree(source: string): Tree {
	if (!parser) parser = new TypstParser();
	return parser.parse(source);
}

export type Seg = {
	blocks: PmNode[];
	from: number;
	to: number;
};

export function ensureBlocks(blocks: PmNode[]): PmNode[] {
	return blocks.length > 0 ? blocks : [el('paragraph')];
}

/** true when nothing but whitespace remains before the paragraph ends. */
export function restOnlySpace(kids: SyntaxNode[], from: number): boolean {
	for (let j = from; j < kids.length; j++) {
		if (kids[j].name === 'Parbreak') return true;
		if (kids[j].name !== 'Space') return false;
	}
	return true;
}

/**
 * A call stands alone in its paragraph when nothing but an optional trailing `<label>` follows it.
 * Returns that label node (null when there is none) plus the index to resume from; null means real
 * content follows, so the call is inline rather than a block of its own.
 *
 * Shared by the modelled path and the raw-island fallback deliberately. When only figureSeg knew
 * about trailing labels, `#figure(table(...)) <tab-x>` whose table was too rich to model fell out
 * of the fallback too (a Label is not whitespace) and degraded into a paragraph of inline chips -
 * a 17-line block crammed into an inline span. Byte fidelity survived, which is why the round-trip
 * tests stayed green; only the node shape was wrong.
 */
export function convertMarkup(kids: SyntaxNode[], src: string): Seg[] {
	const segs: Seg[] = [];
	let buf: SyntaxNode[] = [];

	function flushPara() {
		while (buf.length > 0 && buf[buf.length - 1].name === 'Space') buf.pop();
		if (buf.length === 0) return;
		const content = convertInline(buf, src, []);
		if (content.length > 0) {
			segs.push({
				blocks: [el('paragraph', { indent: 'auto' }, content)],
				from: buf[0].from,
				to: buf[buf.length - 1].to
			});
		}
		buf = [];
	}

	for (let i = 0; i < kids.length; i++) {
		const k = kids[i];
		switch (k.name) {
			case 'Parbreak':
				flushPara();
				break;
			case 'Space':
				if (buf.length > 0) buf.push(k); // leading whitespace is inter-block gap, not content
				break;
			case 'Heading':
				flushPara();
				segs.push(headingSeg(k, src));
				break;
			case 'ListItem':
			case 'EnumItem': {
				flushPara();
				const { seg, next } = listSeg(kids, i, src);
				segs.push(seg);
				i = next - 1;
				break;
			}
			case 'TermItem': {
				flushPara();
				const { seg, next } = termSeg(kids, i, src);
				segs.push(seg);
				i = next - 1;
				break;
			}
			case 'Raw': {
				const delim = k.firstChild;
				const isFence = delim != null && delim.name === 'RawDelim' && delim.to - delim.from >= 3;
				if (isFence && buf.length === 0) {
					const lang = childOf(k, 'RawLang');
					const last = k.lastChild;
					const innerFrom = (lang ?? delim).to;
					const innerTo = last && last.name === 'RawDelim' && last !== delim ? last.from : k.to;
					const content = src.slice(innerFrom, innerTo).replace(/^\n/, '').replace(/\n$/, '');
					const infoString = lang ? src.slice(lang.from, lang.to) : '';
					segs.push({
						// no infoString string means NO language recorded: plain text, no settings chip
						blocks: [el('code_block', { lang: infoString, env: 'fence', args: infoString }, txtNodes(content))],
						from: k.from,
						to: k.to
					});
				} else {
					buf.push(k);
				}
				break;
			}
			case 'Hash': {
				const next = kids[i + 1];
				if (next && STATEMENT_KINDS.has(next.name)) {
					flushPara();
					segs.push({ blocks: [includeOrRaw(k, next, src)], from: k.from, to: next.to });
					i++;
				} else if (next && buf.length === 0) {
					const fig = figureSeg(kids, i, src) ?? tableSeg(kids, i, src) ?? quoteSeg(kids, i, src);
					const alone = aloneWithLabel(kids, i + 2);
					if (fig) {
						segs.push(fig.seg);
						i = fig.next - 1;
					} else if (alone && !alone.label && src.slice(next.from, next.to) === 'line(length: 100%)') {
						// the canonical full-width divider, byte-exact; any other #line stays raw. A
						// LABELLED one stays raw too - horizontal_rule has nowhere to keep the label,
						// so swallowing it here would delete it on the next save
						segs.push({ blocks: [el('horizontal_rule')], from: k.from, to: next.to });
						i++;
					} else if (alone && !linkParts(next, src) && !markCallParts(next, src)) {
						// a call standing alone in its paragraph (#lorem, unmodeled #figure): raw block,
						// with any trailing <label> swallowed into the island so it stays byte-exact AND
						// stays one block. links and mark calls are inline content even alone - a fully
						// underlined paragraph serializes as a lone #underline[..] and must parse back
						// as prose
						const end = alone.label ?? next;
						segs.push({ blocks: [rawBlock(src.slice(k.from, end.to))], from: k.from, to: end.to });
						i = alone.next - 1;
					} else {
						buf.push(k);
					}
				} else {
					buf.push(k);
				}
				break;
			}
			case 'LineComment':
			case 'BlockComment':
				if (buf.length === 0) {
					segs.push({ blocks: [rawBlock(src.slice(k.from, k.to))], from: k.from, to: k.to });
				} else {
					buf.push(k);
				}
				break;
			case 'Equation': {
				// an optional trailing <label> belongs to the equation (typst attaches it to the
				// preceding block); it becomes the node's label attr so @refs can point at it
				let j = i + 1;
				while (kids[j]?.name === 'Space') j++;
				const labelNode = kids[j]?.name === 'Label' ? kids[j] : null;
				const after = labelNode ? j + 1 : i + 1;
				if (buf.length === 0 && restOnlySpace(kids, after)) {
					const latex = typstMathToLatex(k, src);
					const to = (labelNode ?? k).to;
					if (latex != null) {
						segs.push({
							blocks: [
								el(
									'block_math',
									{
										label: labelNode ? src.slice(labelNode.from + 1, labelNode.to - 1) : null,
										numbered: false,
										environment: null,
										lineLabels: [],
										typst: equationInner(k, src).trim(),
										latexOrig: latex
									},
									txtNodes(latex)
								)
							],
							from: k.from,
							to
						});
					} else {
						// untranslatable: the label rides inside the raw island, still byte-exact
						segs.push({ blocks: [rawBlock(src.slice(k.from, to))], from: k.from, to });
					}
					i = after - 1;
				} else {
					buf.push(k);
				}
				break;
			}
			default:
				buf.push(k);
		}
	}
	flushPara();
	return segs;
}

/** `image("path")` or `image("path", <anything>)`: the path plus the extra args verbatim, so
 *  width:/height:/fit: survive round trips untouched. Any other shape is not an image call. */
function includeOrRaw(hash: SyntaxNode, stmt: SyntaxNode, src: string): PmNode {
	if (stmt.name === 'ModuleInclude') {
		const real = children(stmt).filter((c) => !['Include', 'Space'].includes(c.name));
		if (real.length === 1 && real[0].name === 'Str') {
			const path = unquote(src.slice(real[0].from, real[0].to));
			if (/\.typ$/i.test(path)) return el('includedoc', { path, command: 'typst' });
		}
	}
	return rawBlock(src.slice(hash.from, stmt.to));
}

/** Recreate `node` with an `orig` attr; types that don't declare it pass through unchanged. */
function withOrig(node: PmNode, orig: Record<string, unknown>): PmNode {
	if (!node.type.spec.attrs || !('orig' in node.type.spec.attrs)) return node;
	return node.type.create({ ...node.attrs, orig }, node.content, node.marks);
}

export type TypstParseResult = {
	doc: PmNode;
};

export function typstToProseMirror(source: string): TypstParseResult {
	const kids = children(parseTree(source).topNode);
	const segs = convertMarkup(kids, source);

	// stamp-and-push, the shared pushBlocks contract: every block gets a seq; multi-block
	// constructs (a list run) share a group so verbatim substitution is all-or-nothing
	const result: PmNode[] = [];
	let seq = 0;
	let prevEnd = 0;
	let group = 0;
	for (const s of segs) {
		if (s.blocks.length === 0) continue;
		const spanOk = s.from >= prevEnd && s.to <= source.length && s.from < s.to;
		const slice = spanOk ? source.slice(s.from, s.to) : null;
		const pre = spanOk ? source.slice(prevEnd, s.from) : null;
		const g = spanOk && s.blocks.length > 1 ? group++ : null;
		for (let b = 0; b < s.blocks.length; b++) {
			const sq = seq++;
			if (slice == null) {
				result.push(withOrig(s.blocks[b], { seq: sq }));
				continue;
			}
			const orig: Record<string, unknown> = { latex: slice, pre: b === 0 ? pre : '', seq: sq, norm: null, start: s.from };
			if (g != null) {
				orig.group = g;
				orig.groupIndex = b;
				orig.groupSize = s.blocks.length;
			}
			result.push(withOrig(s.blocks[b], orig));
		}
		if (spanOk) prevEnd = Math.max(prevEnd, s.to);
	}

	// an empty or whitespace-only file still needs one paragraph (doc content is block+); its
	// bytes ride along as the paragraph's protected leading gap, so even "\r\n" round-trips
	if (result.length === 0) {
		const orig = { latex: '', pre: source, seq: 0, norm: null, start: source.length };
		return { doc: el('doc', { docTail: { text: '', afterSeq: 0 } }, [withOrig(el('paragraph', { indent: 'auto' }), orig)]) };
	}

	// trailing bytes past the last block belong to no node; stash them so a pristine save
	// reproduces the file's exact tail (an EMPTY tail protects a missing final newline too)
	return { doc: mergeAdjacentRawBlocks(el('doc', { docTail: { text: source.slice(prevEnd), afterSeq: seq - 1 } }, result)) };
}
