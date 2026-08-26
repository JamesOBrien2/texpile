import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { visualDiffKey } from '$lib/editor/visual/diff/visualDiffPlugin';

export function placeholderPlugin(text: string) {
	return new Plugin({
		props: {
			decorations(state) {
				// An empty document inside a comparison is not a blank page waiting to be written in.
				// It is a file that has been deleted, and the diff renders what was in it right here;
				// inviting someone to start writing over that is the wrong sentence. Only reachable
				// while the diff plugin is attached, which is only while a comparison is open.
				if (visualDiffKey.getState(state)?.set) return;
				const doc = state.doc;
				const first = doc.firstChild;
				if (doc.childCount == 1 && first?.isTextblock && first.content.size == 0)
					return DecorationSet.create(doc, [Decoration.widget(1, document.createTextNode(text))]);
			}
		}
	});
}
