import { Plugin } from 'prosemirror-state';
import { editorViewStore as editorviewstore } from '$lib/stores/editorStore';

export function menuUpdatePlugin() {
	return new Plugin({
		view() {
			return {
				update: (view) => {
					editorviewstore.set(view);
				}
			};
		}
	});
}
