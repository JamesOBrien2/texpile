import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export function placeholderPlugin(text: string) {
	return new Plugin({
		props: {
			decorations(state) {
				const doc = state.doc;
				const first = doc.firstChild;
				if (doc.childCount == 1 && first?.isTextblock && first.content.size == 0)
					return DecorationSet.create(doc, [Decoration.widget(1, document.createTextNode(text))]);
			}
		}
	});
}
