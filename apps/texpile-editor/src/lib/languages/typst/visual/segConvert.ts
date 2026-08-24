// heading/list/term/quote block builders. bodies hold full markup, so this module and the
// markup walker in converter.ts are mutually recursive; ESM live bindings make the circular
// import safe (nothing runs at module init).
import type { SyntaxNode } from '@lezer/common';
import { buildNode } from './builders';
import { children, childOf, convertInline } from './inlineConvert';
import { convertMarkup, ensureBlocks, restOnlySpace, type Seg } from './converter';
import { ARG_PUNCT } from './tableConvert';

export function aloneWithLabel(kids: SyntaxNode[], after: number): { label: SyntaxNode | null; next: number } | null {
	let j = after;
	if (kids[j]?.name === 'Space' && kids[j + 1]?.name === 'Label') j++;
	const label = kids[j]?.name === 'Label' ? kids[j] : null;
	if (label) j++;
	return restOnlySpace(kids, j) ? { label, next: j } : null;
}

export function headingSeg(k: SyntaxNode, src: string): Seg {
	const marker = childOf(k, 'HeadingMarker');
	const level = Math.min(6, Math.max(1, marker ? marker.to - marker.from : 1));
	const markup = childOf(k, 'Markup');
	const content = markup ? convertInline(children(markup), src, []) : [];
	return { blocks: [buildNode('heading', { level, numbered: true }, content)], from: k.from, to: k.to };
}

/** consecutive same-kind items separated by plain whitespace form ONE list. */
export function listSeg(kids: SyntaxNode[], i: number, src: string): { seg: Seg; next: number } {
	const kindName = kids[i].name;
	const items: SyntaxNode[] = [kids[i]];
	let j = i + 1;
	while (j < kids.length) {
		if (kids[j].name === kindName) {
			items.push(kids[j]);
			j++;
		} else if (kids[j].name === 'Space' && kids[j + 1]?.name === kindName) {
			j++;
		} else {
			break;
		}
	}
	const kind = kindName === 'ListItem' ? 'bullet' : 'ordered';
	// an explicit "3." enum marker sets the run's start; "+" auto-numbers from 1
	const firstMarker = childOf(items[0], 'EnumMarker');
	const startMatch = firstMarker ? /^(\d+)[.)]/.exec(src.slice(firstMarker.from, firstMarker.to)) : null;
	const start = startMatch ? Number(startMatch[1]) : 1;
	const blocks = items.map((item, idx) => {
		const markup = childOf(item, 'Markup');
		const inner = markup ? convertMarkup(children(markup), src).flatMap((s) => s.blocks) : [];
		return buildNode(
			'list',
			{
				kind,
				// flat-list only reads `order` on the first node of an ordered run (CSS counter-set)
				order: kind === 'ordered' ? (idx === 0 ? start : 1) : null,
				checked: null,
				collapsed: false,
				preBody: null
			},
			ensureBlocks(inner)
		);
	});
	return { seg: { blocks, from: items[0].from, to: items[items.length - 1].to }, next: j };
}

/** consecutive `/ term: description` items form ONE run, mirroring listSeg. */
export function termSeg(kids: SyntaxNode[], i: number, src: string): { seg: Seg; next: number } {
	const items: SyntaxNode[] = [kids[i]];
	let j = i + 1;
	while (j < kids.length) {
		if (kids[j].name === 'TermItem') {
			items.push(kids[j]);
			j++;
		} else if (kids[j].name === 'Space' && kids[j + 1]?.name === 'TermItem') {
			j++;
		} else {
			break;
		}
	}
	const blocks = items.map((item) => {
		const markups = children(item).filter((c) => c.name === 'Markup');
		const title = buildNode('term_title', null, markups[0] ? convertInline(children(markups[0]), src, []) : []);
		const desc = markups[1] ? convertMarkup(children(markups[1]), src).flatMap((s) => s.blocks) : [];
		return buildNode('term_item', null, [title, ...ensureBlocks(desc)]);
	});
	return { seg: { blocks, from: items[0].from, to: items[items.length - 1].to }, next: j };
}

/**
 * The block walker: children of a Markup node -> block segments. Runs at the top level (where
 * the caller stamps orig) and inside list items (where it doesn't).
 */
export function quoteSeg(kids: SyntaxNode[], i: number, src: string): { seg: Seg; next: number } | null {
	const hash = kids[i];
	const call = kids[i + 1];
	if (!call || !restOnlySpace(kids, i + 2)) return null;
	if (call.name !== 'FuncCall') return null;
	const ident = call.firstChild;
	if (!ident || ident.name !== 'Ident' || src.slice(ident.from, ident.to) !== 'quote') return null;
	const args = ident.nextSibling;
	if (!args || args.name !== 'Args') return null;
	const real = children(args).filter((c) => !ARG_PUNCT.includes(c.name));
	if (real.length !== 2 || real[0].name !== 'Named' || real[1].name !== 'ContentBlock') return null;
	const nIdent = real[0].firstChild;
	if (!nIdent || nIdent.name !== 'Ident' || src.slice(nIdent.from, nIdent.to) !== 'block') return null;
	const bool = children(real[0]).find((c) => c.name === 'Bool');
	if (!bool || src.slice(bool.from, bool.to) !== 'true') return null;
	const markup = childOf(real[1], 'Markup');
	const blocks = markup ? convertMarkup(children(markup), src).flatMap((s) => s.blocks) : [];
	return { seg: { blocks: [buildNode('blockquote', null, ensureBlocks(blocks))], from: hash.from, to: call.to }, next: i + 2 };
}

/**
 * `#include "chapter.typ"` and nothing fancier becomes a navigable chip; any other include form
 * (expressions, missing extension, import-like paths) stays a raw block. The path keeps its
 * extension because Typst requires it — the chip's opener defaults to .typ only as a fallback.
 */
