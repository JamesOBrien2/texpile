// Insert-menu entries for the markdown block handle (the + / drag / delete gutter): only
// constructs mdSchema can hold, only markdown vocabulary. Same BlockInsertItem contract as the
// LaTeX list, so the shared BlockHandle renders either.
import type { Schema, Node as PMNode } from 'prosemirror-model';
import {
	Type,
	Heading1,
	Heading2,
	Heading3,
	List,
	ListOrdered,
	ListChecks,
	Quote,
	Table as TableIcon,
	SquareRadical,
	Code,
	Minus
} from '@lucide/svelte';
import type { BlockInsertItem } from '$lib/editor/extensions/blockInsertItems';
import { m } from '$lib/paraglide/messages';

/** GFM tables need a header row; the defaults give 1 header + 2 body rows, 2 columns. */
export function mdTableNode(schema: Schema, rows = 3, cols = 2): PMNode {
	function p() {
		return schema.nodes.paragraph.createAndFill()!;
	}
	function cell(type: 'table_header' | 'table_cell') {
		return schema.nodes[type].createAndFill(null, p())!;
	}
	function row(type: 'table_header' | 'table_cell') {
		return schema.nodes.table_row.create(
			null,
			Array.from({ length: Math.max(1, cols) }, () => cell(type))
		);
	}
	// `rows` counts the header row: a GFM pipe table always has one, the rest are body rows
	return schema.nodes.table.create(null, [row('table_header'), ...Array.from({ length: Math.max(1, rows - 1) }, () => row('table_cell'))]);
}

function listItem(schema: Schema, kind: 'bullet' | 'ordered' | 'task') {
	return schema.nodes.list.create(
		{ kind, order: kind === 'ordered' ? 1 : null, checked: kind === 'task' ? false : null, collapsed: false },
		schema.nodes.paragraph.create()
	);
}

export const MD_BLOCK_INSERT_ITEMS: BlockInsertItem[] = [
	{ label: () => m.blockmenu_text(), icon: Type, make: (s) => s.nodes.paragraph.create(), select: 'in' },
	{ label: () => m.mdtoolbar_heading_n({ n: 1 }), icon: Heading1, make: (s) => s.nodes.heading.create({ level: 1 }), select: 'in' },
	{ label: () => m.mdtoolbar_heading_n({ n: 2 }), icon: Heading2, make: (s) => s.nodes.heading.create({ level: 2 }), select: 'in' },
	{ label: () => m.mdtoolbar_heading_n({ n: 3 }), icon: Heading3, make: (s) => s.nodes.heading.create({ level: 3 }), select: 'in' },
	{ label: () => m.blockmenu_bullet_list(), icon: List, make: (s) => listItem(s, 'bullet'), select: 'in' },
	{ label: () => m.blockmenu_numbered_list(), icon: ListOrdered, make: (s) => listItem(s, 'ordered'), select: 'in' },
	{ label: () => m.mdtoolbar_task_list(), icon: ListChecks, make: (s) => listItem(s, 'task'), select: 'in' },
	{
		label: () => m.blockmenu_quote(),
		icon: Quote,
		make: (s) => s.nodes.blockquote.create(null, s.nodes.paragraph.create()),
		select: 'in'
	},
	{ label: () => m.blockmenu_table(), icon: TableIcon, make: (s) => mdTableNode(s), select: 'node' },
	{ label: () => m.blockmenu_math_block(), icon: SquareRadical, make: (s) => s.nodes.block_math.create({}, s.text(' ')), select: 'node' },
	{
		label: () => m.blockmenu_code_block(),
		icon: Code,
		make: (s) => s.nodes.code_block.createAndFill({ env: 'fence', args: '' }),
		select: 'node'
	},
	{ label: () => m.mdtoolbar_hr(), icon: Minus, make: (s) => s.nodes.horizontal_rule.create(), select: 'node' }
];
