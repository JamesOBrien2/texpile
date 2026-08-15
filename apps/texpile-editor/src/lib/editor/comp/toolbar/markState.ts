import { toggleMark } from 'prosemirror-commands';
import type { Command, EditorState } from 'prosemirror-state';
import type { MarkType } from 'prosemirror-model';

export function markIsActive(state: EditorState, type: MarkType): boolean {
	const { from, to, empty } = state.selection;
	if (empty) return !!type.isInSet(state.storedMarks || state.selection.$head.marks());
	return state.doc.rangeHasMark(from, to, type);
}

/** color attr of the first `type` mark in the selection, else null. rangeHasMark only returns a boolean, so scan nodes for the mark instance (reading .attrs off the boolean froze the whole UI). */
export function activeMarkColor(state: EditorState, type: MarkType): string | null {
	const { from, to, empty } = state.selection;
	if (empty) {
		const mark = type.isInSet(state.storedMarks || state.selection.$head.marks());
		return mark ? mark.attrs.color : null;
	}
	let color: string | null = null;
	state.doc.nodesBetween(from, to, (node) => {
		if (color !== null) return false;
		const mark = type.isInSet(node.marks);
		if (mark) color = mark.attrs.color;
	});
	return color;
}

/**
 * The toolbars' link toggle, shared by all three dialects (each passes its own schema's mark).
 *
 * On a bare caret outside a link, toggleMark would only arm a stored mark - the button looked
 * like it did nothing - so insert the placeholder itself as linked text instead; the link
 * tooltip is where the href gets edited either way. A selection toggles the mark on it.
 */
export function toggleLinkCommand(type: MarkType): Command {
	return (state, dispatch) => {
		if (state.selection.empty && !markIsActive(state, type)) {
			const text = state.schema.text('https://', [type.create({ href: 'https://' })]);
			dispatch?.(state.tr.replaceSelectionWith(text, false).scrollIntoView());
			return true;
		}
		return toggleMark(type, { href: 'https://', title: null })(state, dispatch);
	};
}
