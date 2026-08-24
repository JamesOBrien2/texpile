// the visual editor's right-click menu entries: clipboard actions for every dialect, and the
// table block set with its selection-dependent visibility
import type { Component } from 'svelte';
import { DOMSerializer } from 'prosemirror-model';
import {
	addColumnBefore,
	addColumnAfter,
	deleteColumn,
	addRowBefore,
	addRowAfter,
	deleteRow,
	deleteTable,
	mergeCells,
	splitCell
} from 'prosemirror-tables';
import { Copy, Clipboard, Plus, Trash2, Combine, SplitSquareHorizontal } from '@lucide/svelte';
import { editorViewStore } from '$lib/stores/editorStore';
import { toaster } from '$lib/modals/toaster-svelte';
import { sliceToLatex, pasteLatexText } from '$lib/editor/visual/extensions/latexClipboard';
import { sliceToTypst } from '$lib/languages/typst/visual/clipboard';
import { sliceToMarkdown } from '$lib/languages/markdown/visual/clipboard';
import type { Dialect } from '$lib/editor/visual/dialect';
import { m } from '$lib/paraglide/messages';

export type ContextMenuEntry = {
	type: 'item' | 'separator';
	label?: string;
	icon?: Component;
	shortcut?: string;
	action?: () => void;
	/** which table selection kinds the entry applies to */
	showFor?: string[];
	showWhen?: () => boolean;
};

export type TableMenuDeps = {
	dialect: Dialect;
	canMerge(): boolean;
	canSplit(): boolean;
};

function editorView() {
	return editorViewStore.current;
}

export function buildMenuItems(dialect: Dialect) {
	return [
		{
			type: 'item',
			label: m.ctxmenu_copy(),
			icon: Copy,
			shortcut: 'Mod+C',
			action: () => {
				const { state } = editorView()!;
				const { from, to } = state.selection;
				if (from === to) {
					return;
				} // nothing to copy
				const slice = state.doc.slice(from, to);
				const fragment = slice.content;

				// the VIEW's schema, not the tex one: the fragment's nodes belong to whichever
				// dialect this editor runs, and nodes must never meet a foreign Schema object
				const serializer = DOMSerializer.fromSchema(state.schema);

				const div = document.createElement('div');
				div.appendChild(serializer.serializeFragment(fragment));
				const html = div.innerHTML;

				// both flavors: HTML for rich internal paste, plus a plain-text form in the
				// EDITOR'S OWN markup - one serializer per dialect, matching what that editor's
				// clipboardTextSerializer puts on the clipboard for Ctrl+C
				let plain: string;
				try {
					plain = dialect === 'typst' ? sliceToTypst(slice) : dialect === 'markdown' ? sliceToMarkdown(slice) : sliceToLatex(slice);
				} catch {
					plain = state.doc.textBetween(from, to, '\n\n');
				}
				navigator.clipboard
					.write([
						new ClipboardItem({
							'text/html': new Blob([html], { type: 'text/html' }),
							'text/plain': new Blob([plain], { type: 'text/plain' })
						})
					])
					.then(() => {
						toaster.info({ title: m.ctxmenu_copied_toast(), duration: 3000 });
					})
					.catch((_err) => {
						toaster.info({ title: m.ctxmenu_copy_failed_toast(), duration: 3000 });
					});
			}
		},
		{
			type: 'item',
			label: m.ctxmenu_paste(),
			icon: Clipboard,
			shortcut: 'Mod+V',
			action: async () => {
				try {
					const clipboardItems = await navigator.clipboard.read();
					for (const item of clipboardItems) {
						if (item.types.includes('text/html')) {
							const blob = await item.getType('text/html');
							const text = await blob.text();
							editorView()!.pasteHTML(text);
						} else if (item.types.includes('text/plain')) {
							const blob = await item.getType('text/plain');
							const text = await blob.text();
							// LaTeX text pastes as rich nodes, same as the Ctrl+V path — but ONLY in the
							// LaTeX editor: the parser emits tex-schema nodes, which must never land in
							// a typst or markdown document (nor does either one's Ctrl+V do this)
							if (dialect !== 'latex' || !pasteLatexText(editorView()!, text)) editorView()!.pasteText(text);
						} else {
							toaster.warning({
								title: m.ctxmenu_paste_images_hint_toast(),
								duration: 3000
							});
						}
					}
				} catch (_err) {
					toaster.warning({
						title: m.ctxmenu_paste_read_failed_toast(),
						duration: 3000
					});
				}
			}
		},
		{
			type: 'item',
			label: m.ctxmenu_paste_without_formatting(),
			icon: Clipboard,
			shortcut: 'Mod+Shift+V',
			action: async () => {
				try {
					const clipboardItems = await navigator.clipboard.read();
					for (const item of clipboardItems) {
						if (item.types.includes('text/plain')) {
							const blob = await item.getType('text/plain');
							const text = await blob.text();
							editorView()!.pasteText(text);
						} else if (item.types.includes('text/html')) {
							const blob = await item.getType('text/html');
							const text = await blob.text();
							const plainText = text.replace(/<[^>]+>/g, '');
							editorView()!.pasteText(plainText);
						}
					}
				} catch (_err) {
					toaster.warning({
						title: m.ctxmenu_paste_plain_read_failed_toast(),
						duration: 3000
					});
				}
			}
		}
	];
}

export function buildTableMenuItems(deps: TableMenuDeps): ContextMenuEntry[] {
	const { dialect } = deps;
	const cellMerging = dialect !== 'markdown';
	return [
		{
			type: 'item',
			label: m.ctxmenu_add_column_before(),
			icon: Plus,
			showFor: ['cell', 'column'],
			action: () => {
				const view = editorView()!;
				const { state, dispatch } = view;
				addColumnBefore(state, dispatch);
			}
		},
		{
			type: 'item',
			label: m.ctxmenu_add_column_after(),
			icon: Plus,
			showFor: ['cell', 'column'],
			action: () => {
				const view = editorView()!;
				const { state, dispatch } = view;
				addColumnAfter(state, dispatch);
			}
		},
		{ type: 'separator', showFor: ['cell', 'column'] },
		{
			type: 'item',
			label: m.ctxmenu_add_row_before(),
			icon: Plus,
			showFor: ['cell', 'row'],
			action: () => {
				const view = editorView()!;
				const { state, dispatch } = view;
				addRowBefore(state, dispatch);
			}
		},
		{
			type: 'item',
			label: m.ctxmenu_add_row_after(),
			icon: Plus,
			showFor: ['cell', 'row'],
			action: () => {
				const view = editorView()!;
				const { state, dispatch } = view;
				addRowAfter(state, dispatch);
			}
		},
		{ type: 'separator', showFor: ['cell', 'column', 'row'] },
		{
			type: 'item',
			label: m.ctxmenu_merge_cells(),
			icon: Combine,
			showFor: ['cell'],
			showWhen: () => cellMerging && deps.canMerge(),
			action: () => {
				const view = editorView()!;
				const { state, dispatch } = view;
				mergeCells(state, dispatch);
			}
		},
		{
			type: 'item',
			label: m.ctxmenu_split_cell(),
			icon: SplitSquareHorizontal,
			showFor: ['cell'],
			showWhen: () => cellMerging && deps.canSplit(),
			action: () => {
				const view = editorView()!;
				const { state, dispatch } = view;
				splitCell(state, dispatch);
			}
		},
		{ type: 'separator', showFor: ['cell'], showWhen: () => cellMerging && (deps.canMerge() || deps.canSplit()) },
		{
			type: 'item',
			label: m.ctxmenu_delete_column(),
			icon: Trash2,
			showFor: ['cell', 'column'],
			action: () => {
				const view = editorView()!;
				const { state, dispatch } = view;
				deleteColumn(state, dispatch);
			}
		},
		{
			type: 'item',
			label: m.ctxmenu_delete_row(),
			icon: Trash2,
			showFor: ['cell', 'row'],
			action: () => {
				const view = editorView()!;
				const { state, dispatch } = view;
				deleteRow(state, dispatch);
			}
		},
		{
			type: 'item',
			label: m.ctxmenu_delete_table(),
			icon: Trash2,
			showFor: ['cell', 'column', 'row'],
			action: () => {
				const view = editorView()!;
				const { state, dispatch } = view;
				deleteTable(state, dispatch);
			}
		}
	];
}
