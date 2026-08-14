// TEMPORARY dev harness for the code block node view. Delete when done.
import './app.css';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { schema } from '$lib/schema/schema';
import CodeBlockView from '$lib/editor/extensions/codemirrorbridge/cmview.svelte';

const doc = schema.nodes.doc.create(null, [
	schema.nodes.paragraph.create(null, schema.text('paragraph before')),
	schema.nodes.code_block.create(
		{ lang: 'Python', env: 'lstlisting', args: '[language=Python, caption={A listing.}]' },
		schema.text('def fib(n: int) -> int:\n    return n')
	),
	schema.nodes.paragraph.create(null, schema.text('paragraph after'))
]);

const state = EditorState.create({
	doc,
	plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo }), keymap(baseKeymap)]
});

const mountEl = document.getElementById('app')!;
mountEl.style.maxWidth = '700px';
mountEl.style.margin = '2rem auto';

const view = new EditorView(mountEl, {
	state,
	nodeViews: {
		code_block: (node, v, getPos) => new CodeBlockView(node, v, getPos as () => number)
	}
});

Object.assign(window as never, { pmview: view, TextSelection });
