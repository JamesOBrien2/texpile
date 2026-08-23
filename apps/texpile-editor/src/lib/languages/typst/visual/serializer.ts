// Deterministic ProseMirror -> Typst serializer: third sibling of latexSerializer and the
// markdown serializer. String-returning handlers per node type over the shared Ctx contract;
// doc assembly (verbatim orig substitution + per-block memo) delegated to blockAssembly.
// Convention: every block handler ends with its own separation ('\n\n', lists '\n' mid-run),
// so plain concatenation of parts is a valid document.
import type { Node } from 'prosemirror-model';
import { createBlockAssembly, type DocSerializeResult } from '$lib/serializer/blockAssembly';
import type { Ctx } from '$lib/serializer/types';
import { escTypst, renderInline, mathTypstOf, typStr } from './typstInline';
import { tableBody } from './tableSerializer';
export { escTypst, renderInline } from './typstInline';

/** a math node's typst: the stored original while the LaTeX is untouched, else MathLive's own
 *  LaTeX->typst serializer, else the stored original (an edit is dropped only if conversion
 *  fails, which try/catch makes near-impossible), else the raw latex as a last resort. */
function indentAfterFirstLine(text: string, indent: string): string {
	return text
		.split('\n')
		.map((l, i) => (i === 0 || l === '' ? l : indent + l))
		.join('\n');
}

function nextSibling(ctx: Ctx): Node | null {
	return ctx.parent && ctx.index < ctx.parent.childCount - 1 ? ctx.parent.child(ctx.index + 1) : null;
}

/** children serialized and concatenated (handlers carry their own separators), tail trimmed. */
function renderBlocks(parent: Node): string {
	let out = '';
	parent.forEach((child, _offset, i) => {
		out += serializeTypNode(child, { parent, index: i, isLastChild: i === parent.childCount - 1, inTableCell: false });
	});
	return out.replace(/\n+$/, '');
}

/** the `table(...)` call itself, extra-indented by `indent`; '' when the table has no rows.
 *  Shared by the bare-table handler (indent '') and the figure wrapper (indent '  '). */
function isEmptyParagraph(node: Node): boolean {
	if (node.type.name !== 'paragraph') return false;
	let empty = true;
	node.forEach((c) => {
		if (c.isText ? c.text?.trim() : c.type.name !== 'hard_break') empty = false;
	});
	return empty;
}

type NodeHandler = (node: Node, ctx: Ctx) => string;

const NODES: Record<string, NodeHandler> = {
	paragraph(node) {
		if (isEmptyParagraph(node)) return ''; // blank lines are semantic no-ops, as in both siblings
		return renderInline(node, true) + '\n\n';
	},

	heading(node) {
		if (node.childCount === 0) return '';
		const level = Math.min(6, Math.max(1, Number(node.attrs.level ?? 1)));
		return `${'='.repeat(level)} ${renderInline(node, false)}\n\n`;
	},

	code_block(node) {
		const infoString = String(node.attrs.args ?? '').trim();
		const content = node.textContent;
		const runs = content.match(/`{3,}/g);
		const fence = '`'.repeat(runs ? Math.max(3, ...runs.map((r) => r.length)) + 1 : 3);
		return `${fence}${infoString}\n${content}\n${fence}\n\n`;
	},

	// raw source islands (code mode, math, terms, comments): verbatim
	raw_latex: (node) => (node.textContent ? node.textContent + '\n\n' : ''),

	includedoc: (node) => `#include ${typStr(String(node.attrs.path ?? ''))}\n\n`,

	image(node) {
		// `options` is the verbatim extra-args slice (width: 70%, fit: "cover", ...); re-emitted
		// untouched so a resize/crop written in source survives the visual editor
		const rawOpts = typeof node.attrs.options === 'string' ? node.attrs.options.trim() : '';
		let optsStr = rawOpts;
		// a drag-resize leaves snapped pixel width/maxWidth attrs (never set by the converter);
		// translate them to a percent of the text column, replacing any width: already carried.
		// wysiwym by design - the editor column stands in for the page width
		const w = Number(node.attrs.width);
		const max = Number(node.attrs.maxWidth);
		if (Number.isFinite(w) && Number.isFinite(max) && w > 0 && max > 0) {
			const pct = Math.min(100, Math.max(1, Math.round((w / max) * 100)));
			const rest = rawOpts
				.split(',')
				.map((s) => s.trim())
				.filter((s) => s && !/^width:/.test(s));
			optsStr = [`width: ${pct}%`, ...rest].join(', ');
		}
		const opts = optsStr ? `, ${optsStr}` : '';
		const img = `image(${typStr(String(node.attrs.src ?? ''))}${opts})`;
		const caption = node.attrs.showCaption !== false ? renderInline(node, false).trim() : '';
		const label = node.attrs.label ? ` <${String(node.attrs.label)}>` : '';
		// a bare #image is one the source never wrapped in a figure; keep it bare
		if (node.attrs.numbered === false && !caption && !label) return `#${img}\n\n`;
		return `#figure(${img}${caption ? `, caption: [${caption}]` : ''})${label}\n\n`;
	},

	table(node) {
		const body = tableBody(node, '', renderBlocks);
		return body ? `#${body}\n\n` : '';
	},

	// #figure(table(...), caption: [...]) <label> — the typst way to caption a table
	table_wrapper(node) {
		let table: Node | null = null;
		let captionNode: Node | null = null;
		node.forEach((c) => {
			if (c.type.name === 'table') table = c;
			else if (c.type.name === 'table_caption') captionNode = c;
		});
		if (!table) return '';
		const body = tableBody(table, '  ', renderBlocks);
		if (!body) return '';
		const cap = captionNode as Node | null;
		const caption = cap && cap.childCount > 0 ? renderInline(cap, false).trim() : '';
		const label = node.attrs.label ? ` <${String(node.attrs.label)}>` : '';
		return `#figure(\n  ${body}${caption ? `,\n  caption: [${caption}]` : ''},\n)${label}\n\n`;
	},

	block_math(node) {
		const inner = mathTypstOf(node).trim();
		if (!inner) return '';
		// the label rides after the closing dollar, where typst attaches it to the equation
		const label = node.attrs.label ? ` <${String(node.attrs.label)}>` : '';
		return `$ ${inner} $${label}\n\n`;
	},

	blockquote(node) {
		const inner = renderBlocks(node);
		if (!inner) return '';
		return `#quote(block: true)[\n  ${indentAfterFirstLine(inner, '  ')}\n]\n\n`;
	},

	horizontal_rule() {
		return '#line(length: 100%)\n\n';
	},

	term_item(node, ctx) {
		let title: Node | null = null;
		const rest: string[] = [];
		node.forEach((child, _offset, i) => {
			if (i === 0 && child.type.name === 'term_title') {
				title = child;
				return;
			}
			rest.push(serializeTypNode(child, { parent: node, index: i, isLastChild: i === node.childCount - 1, inTableCell: false }));
		});
		const desc = rest.join('').replace(/\n+$/, '');
		const line = `/ ${title ? renderInline(title, false) : ''}: ${indentAfterFirstLine(desc, '  ')}`;
		const next = nextSibling(ctx);
		return line + (next?.type.name === 'term_item' ? '\n' : '\n\n');
	},

	list(node, ctx) {
		const kind = String(node.attrs.kind ?? 'bullet');
		// '+' auto-numbers; only a run starting off the natural count needs its explicit "N."
		// marker back (order is 1 on every non-first node of a run, by the importer's contract)
		const order = Number(node.attrs.order ?? 1);
		const marker = kind === 'ordered' ? (order !== 1 ? `${order}. ` : '+ ') : '- ';
		// continuation lines must sit past the marker to stay inside the item
		const body = indentAfterFirstLine(renderBlocks(node) || '', ' '.repeat(marker.length));
		const next = nextSibling(ctx);
		const nextSame = next?.type.name === 'list' && next.attrs.kind === kind;
		return marker + body + (nextSame ? '\n' : '\n\n');
	}
};

/** Serialize one node to Typst. Unknown types preserve their content rather than dropping it. */
export function serializeTypNode(node: Node, ctx: Ctx): string {
	const handler = NODES[node.type.name];
	if (handler) return handler(node, ctx);
	if (node.isText) return escTypst(node.text ?? '');
	if (node.isInline) {
		// inline strays (should have come through renderInline) degrade to leafText/plain text
		const leafText = node.type.spec.leafText;
		return leafText ? leafText(node) : node.textContent;
	}
	const inner = renderBlocks(node);
	return inner ? inner + '\n\n' : '';
}

const assembly = createBlockAssembly((node, ctx) => serializeTypNode(node, ctx));

export function serializeToTypst(doc: Node): string {
	return assembly.serializeDocChildrenDetailed(doc).text;
}

export function serializeToTypstDetailed(doc: Node): DocSerializeResult {
	return assembly.serializeDocChildrenDetailed(doc);
}
