// TEMPORARY dev harness: mount the full visual editor over a typst fixture parse, mirroring
// EditorView.svelte's plugin and node-view registration. ?file=NAME picks the fixture. Delete
// when the typ-open freeze is diagnosed.
import './app.css';
import { EditorState, Transaction, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from '$lib/schema/schema';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { undo as historyUndo, redo as historyRedo, history } from 'prosemirror-history';
import { toggleBlockQuote, toggleHeading, cycleParagraphIndent } from '$lib/editor/helperCommands';
import { gapCursor } from 'prosemirror-gapcursor';
import { createMathField } from '$lib/editor/extensions/mathlivebridge/mlcommands';
import { createCodeBlock } from '$lib/editor/extensions/codemirrorbridge/cmcommands';
import { cmarrowHandlers } from '$lib/editor/extensions/codemirrorbridge/cmarrowhandler';
import { menuUpdatePlugin } from '$lib/editor/extensions/toolbarlistenerplugin';
import { dropCursor } from 'prosemirror-dropcursor';
import { columnResizing, fixTables, tableEditing, goToNextCell } from 'prosemirror-tables';
import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-tables/style/tables.css';
import 'prosemirror-gapcursor/style/gapcursor.css';
import '$lib/editor/extensions/image/styles/common.css';
import '$lib/editor/extensions/image/styles/withResize.css';
import '$lib/editor/extensions/image/styles/sideResize.css';
import { imagePlugin } from '$lib/editor/extensions/image';
import { createCursorPlugin } from '$lib/editor/extensions/cursor-plugin';
import { remoteCursorsPlugin } from '$lib/editor/extensions/remoteCursors';
import { pasteUUIDFixPlugin } from '$lib/editor/extensions/paste-uuid-fix';
import { latexClipboardPlugin } from '$lib/editor/extensions/latexClipboard';
import '$lib/editor/styles/cursor.css';
import { createListPlugins, listInputRules, listKeymap } from 'prosemirror-flat-list';
import { inputRules, InputRule, smartQuotes, ellipsis, undoInputRule } from 'prosemirror-inputrules';
import 'prosemirror-flat-list/dist/style.css';
import { placeholderPlugin } from '$lib/editor/extensions/placeholderplugin';
import { tablePlaceholderPlugin } from '$lib/editor/extensions/table/tablePlaceholderPlugin';
import { search } from 'prosemirror-search';
import 'prosemirror-search/style/search.css';
import CitationView from '$lib/editor/extensions/citation/citationView.svelte';
import RefView from '$lib/editor/extensions/ref/refView.svelte';
import { createRefUpdatePlugin } from '$lib/editor/extensions/ref/refUpdatePlugin';
import { createTocPlugin } from '$lib/editor/extensions/tableofcontents/tocPlugin';
import { createPersistentSelectionPlugin } from '$lib/editor/extensions/persistentSelection/persistentSelectionPlugin';
import { createSuggestPlugin } from '$lib/editor/extensions/suggest/suggestPlugin';
import { proofreadPlugin, spellClickBoundaryPlugin } from '$lib/editor/extensions/spellcheck/spellcheckplugin';
import { createTemplateEditorSettings } from '$lib/editor/extensions/image/imageplugin.svelte';
import { createWordCountPlugin } from '$lib/editor/extensions/wordcount/wordCountPlugin';
import { emDashRule, enDashRule, emDashUpgradeRule } from '$lib/editor/extensions/inputrules/dashRules';
import tableWrapperView from '$lib/editor/extensions/table/tableWrapperView.svelte';
import CodeBlockView from '$lib/editor/extensions/codemirrorbridge/cmview.svelte';
import RawLatexView from '$lib/editor/extensions/raw-latex/rawLatexView';
import { RawFigureView, isRawFigure } from '$lib/editor/extensions/raw-latex/rawFigureView';
import { IEEEAuthorView, isIEEEAuthorBlock } from '$lib/editor/extensions/template-specific/ieeeAuthorView';
import InlineLatexView from '$lib/editor/extensions/raw-latex/inlineLatexView';
import { inlinePlaceholder, InlinePlaceholderView } from '$lib/editor/extensions/raw-latex/inlinePlaceholderView';
import { FrontmatterRawView, simpleFrontmatter, PlaceholderRawView, placeholderCommand } from '$lib/editor/extensions/raw-latex/frontmatterView';
import { BibliographyNodeView } from '$lib/editor/extensions/bibliography/bibliographyNodeView.svelte';
import environmentView from '$lib/editor/extensions/environment/environmentView.svelte';
import IncludeDocView from '$lib/editor/extensions/includedoc/includeDocView.svelte';
import { createTrailingParagraphPlugin, buildTrailingParagraphTr } from '$lib/editor/extensions/trailing-paragraph-plugin';
import { createBoundaryClickPlugin } from '$lib/editor/extensions/boundary-click-plugin';
import { createBlockHandlePlugin } from '$lib/editor/extensions/block-handle-plugin.svelte';
import { createNodeFlashPlugin } from '$lib/editor/extensions/flash-plugin';
import { createLinkPlugin } from '$lib/editor/extensions/link';
import { pmComments } from '$lib/editor/extensions/pmComments';
import { isMac } from '$lib/platform';

const w = window as never as { stage: string; pmview?: EditorView; TextSelection?: unknown };
w.stage = 'boot';

async function main() {
	const params = new URLSearchParams(location.search);
	const name = params.get('file') ?? 'main.typ';
	const source = await (await fetch(`/tmp-fixture/${name}`)).text();
	w.stage = 'fetched';

	// ?mode=source: the guest's SOURCE editor - CodeMirror bound to a Y.Text, typst highlighting,
	// fold rail, caret hook - everything but the electron LSP bridge (absent in a browser).
	if (params.get('mode') === 'source') {
		const [{ mount }, { default: SourceEditor }, Y, { Awareness }] = await Promise.all([
			import('svelte'),
			import('$lib/editor/comp/SourceEditor.svelte'),
			import('yjs'),
			import('y-protocols/awareness')
		]);
		const ydoc = new Y.Doc();
		const ytext = ydoc.getText('t');
		ytext.insert(0, source.replace(/\r\n/g, '\n'));
		const awareness = new Awareness(ydoc);
		const useCollab = params.get('collab') !== '0';
		w.stage = 'source-mounting';
		mount(SourceEditor, {
			target: document.getElementById('app')!,
			props: {
				value: source.replace(/\r\n/g, '\n'),
				docPath: name,
				collab: useCollab ? { ytext, awareness } : null,
				onInput: () => {},
				onCaretMove: () => {}
			}
		});
		w.stage = 'mounted';
		return;
	}

	const { parseTypstFile } = await import('$lib/typst/visual/roundtrip');
	const parsed = parseTypstFile(source.replace(/\r\n/g, '\n'), '');
	w.stage = 'parsed';

	const { mathlivePlugin, mlarrowHandlers } = await import('$lib/editor/extensions/mathlivebridge/mlplugin');

	const plugins = [
		gapCursor(),
		dropCursor({ color: 'var(--color-primary-500)', width: 2 }),
		columnResizing(),
		tableEditing(),
		...createListPlugins({ schema }),
		history(),
		...createSuggestPlugin(),
		keymap(listKeymap),
		inputRules({
			rules: [...listInputRules, ...smartQuotes, emDashRule, enDashRule, emDashUpgradeRule, ellipsis] as readonly InputRule[]
		}),
		keymap({
			'Mod-z': (state, dispatch) => historyUndo(state, dispatch),
			'Mod-y': (state, dispatch) => historyRedo(state, dispatch),
			Backspace: undoInputRule,
			'Mod-b': toggleMark(schema.marks.strong),
			'Mod-i': toggleMark(schema.marks.em),
			'Mod-Shift-b': toggleBlockQuote(),
			'Mod-Shift-`': createCodeBlock(),
			'Mod-Alt-0': toggleHeading(0),
			'Mod-Alt-1': toggleHeading(1),
			...(isMac ? {} : { 'Mod-Shift-1': toggleHeading(1) }),
			'Mod-m': createMathField(),
			Tab: (state: EditorState, dispatch: (tr: Transaction) => void) => {
				if (goToNextCell(1)(state, dispatch)) return true;
				cycleParagraphIndent(1)(state, dispatch);
				return true;
			}
		}),
		cmarrowHandlers,
		mlarrowHandlers,
		mathlivePlugin,
		keymap(baseKeymap),
		imagePlugin(createTemplateEditorSettings()),
		menuUpdatePlugin(),
		createCursorPlugin(),
		remoteCursorsPlugin,
		createLinkPlugin(),
		latexClipboardPlugin,
		pasteUUIDFixPlugin,
		search(),
		placeholderPlugin('harness'),
		tablePlaceholderPlugin(),
		createWordCountPlugin(),
		createRefUpdatePlugin(),
		createTocPlugin(),
		createPersistentSelectionPlugin(),
		spellClickBoundaryPlugin,
		proofreadPlugin,
		createTrailingParagraphPlugin(),
		createBoundaryClickPlugin(),
		createBlockHandlePlugin(),
		createNodeFlashPlugin(),
		...pmComments({ onSelect: () => {}, onAdd: () => {}, addLabel: 'Comment' })
	];

	let editorState = EditorState.create({ schema, plugins, doc: parsed.doc });
	const fix = fixTables(editorState);
	if (fix) editorState = editorState.apply(fix.setMeta('addToHistory', false));
	const trail = buildTrailingParagraphTr(editorState);
	if (trail) editorState = editorState.apply(trail.setMeta('addToHistory', false));
	w.stage = 'state-ready';

	const mountEl = document.getElementById('app')!;
	mountEl.style.maxWidth = '700px';
	mountEl.style.margin = '2rem auto';

	const view = new EditorView(mountEl, {
		attributes: { class: 'TexpileEditor', spellcheck: 'false', 'data-show-section-numbers': 'true' },
		state: editorState,
		nodeViews: {
			code_block: (node, v, getPos) => new CodeBlockView(node, v, getPos as () => number),
			raw_latex: (node, v, getPos) =>
				simpleFrontmatter(node.textContent)
					? new FrontmatterRawView(node, v, getPos as () => number)
					: placeholderCommand(node.textContent)?.command === 'printbibliography'
						? new BibliographyNodeView(node, v, getPos as () => number)
						: placeholderCommand(node.textContent)
							? new PlaceholderRawView(node, v, getPos as () => number)
							: isIEEEAuthorBlock(node.textContent)
								? new IEEEAuthorView(node, v, getPos as () => number)
								: isRawFigure(node.textContent)
									? new RawFigureView(node, v, getPos as () => number, '')
									: new RawLatexView(node, v, getPos as () => number),
			inline_latex: (node, v, getPos) =>
				inlinePlaceholder(node.textContent)
					? new InlinePlaceholderView(node, v, getPos as () => number)
					: new InlineLatexView(node, v, getPos as () => number),
			includedoc: (node, v, getPos) => new IncludeDocView(node, v, getPos as () => number, ''),
			environment: environmentView,
			table_wrapper: tableWrapperView,
			citation: (node, v, getPos) => new CitationView(node, v, getPos),
			ref: (node, v) => new RefView(node, v)
		},
		editable: () => true
	});
	view.focus();
	w.pmview = view;
	w.TextSelection = TextSelection;
	w.stage = 'mounted';
}

void main().catch((e) => {
	w.stage = 'error: ' + (e instanceof Error ? e.stack || e.message : String(e));
	console.error(e);
});
