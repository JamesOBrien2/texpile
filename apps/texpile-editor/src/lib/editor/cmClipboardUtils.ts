import type { EditorView as CMView } from '@codemirror/view';

// functions to get CM items

export async function copySelection(view: CMView): Promise<void> {
	const { from, to } = view.state.selection.main;
	const text = view.state.sliceDoc(from, to);
	if (text) await navigator.clipboard.writeText(text).catch(() => {});
}

export async function cutSelection(view: CMView): Promise<void> {
	const { from, to } = view.state.selection.main;
	const text = view.state.sliceDoc(from, to);
	if (text) {
		await navigator.clipboard.writeText(text).catch(() => {});
		view.dispatch({ changes: { from, to, insert: '' } });
	}
	view.focus();
}

export async function pasteAtCursor(view: CMView): Promise<void> {
	const text = await navigator.clipboard.readText().catch(() => '');
	if (text) {
		const { from, to } = view.state.selection.main;
		view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
	}
	view.focus();
}
