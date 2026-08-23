import { citationNodeSpec } from '$lib/editor/extensions/citation/citationSchema';
import { refNodeSpec } from '$lib/editor/extensions/ref/refSchema';
import { createListSpec } from 'prosemirror-flat-list';
import type { NodeSpec, DOMOutputSpec } from 'prosemirror-model';
import { tableNodes, type TableNodesOptions } from 'prosemirror-tables';

const pDOM: DOMOutputSpec = ['p', 0],
	blockquoteDOM: DOMOutputSpec = ['blockquote', { class: 'blockquote' }, 0],
	hrDOM: DOMOutputSpec = ['hr'],
	preDOM: DOMOutputSpec = ['pre', ['code', 0]],
	brDOM: DOMOutputSpec = ['br'];

const tableNodeSpecs = tableNodes({
	tableGroup: 'block',
	cellContent: 'paragraph+',
	cellAttributes: {
		background: {
			default: null,
			getFromDOM(dom) {
				return dom.style.backgroundColor || null;
			},
			setDOMAttr(value, attrs) {
				if (value) attrs.style = (attrs.style || '') + `background-color: ${value};`;
			}
		}
	}
} as TableNodesOptions);

// carry the exact LaTeX table architecture (env name, verbatim colspec, tabularx width,
// \hline/\bottomrule rules) so a parsed table round-trips render-identically instead of being
// reflowed into the default tabularx style. DOM copy/paste falls back to defaults
tableNodeSpecs.table.attrs = {
	...(tableNodeSpecs.table.attrs ?? {}),
	env: { default: null },
	colspec: { default: null },
	tabularxWidth: { default: null },
	bottomRules: { default: '' }
};
tableNodeSpecs.table_row.attrs = {
	...(tableNodeSpecs.table_row.attrs ?? {}),
	topRules: { default: '' }
};

export const nodes = {
	doc: {
		content: 'block+',
		// the body's trailing gap (blank lines before \end{document}) belongs to no block node.
		// { text, afterSeq }: re-emitted verbatim iff the doc still ends with that pristine block
		attrs: { docTail: { default: null } }
	} as NodeSpec,
	paragraph: {
		content: 'inline*',
		group: 'block',
		// 'auto' (no command), 'indent' (\indent), 'noindent' (\noindent)
		attrs: { indent: { default: 'auto' } },
		parseDOM: [{ tag: 'p', getAttrs: (dom) => ({ indent: (dom as HTMLElement).getAttribute('data-indent') || 'auto' }) }],
		toDOM(node) {
			return node.attrs.indent !== 'auto' ? ['p', { 'data-indent': node.attrs.indent }, 0] : pDOM;
		}
	} as NodeSpec,

	blockquote: {
		content: 'block+',
		group: 'block',
		defining: true,
		parseDOM: [{ tag: 'blockquote' }],
		toDOM() {
			return blockquoteDOM;
		}
	} as NodeSpec,

	horizontal_rule: {
		group: 'block',
		parseDOM: [{ tag: 'hr' }],
		toDOM() {
			return hrDOM;
		}
	} as NodeSpec,

	// level 1-3 maps to \section / \subsection / \subsubsection; numbered=false is the starred form
	heading: {
		attrs: { level: { default: 1 }, numbered: { default: true } },
		content: 'inline*',
		group: 'block',
		defining: true,
		parseDOM: [
			{ tag: 'h1', attrs: { level: 1 } },
			{ tag: 'h2', attrs: { level: 2 } },
			{ tag: 'h3', attrs: { level: 3 } }
		],
		toDOM(node) {
			return ['h' + node.attrs.level, node.attrs.numbered === false ? { 'data-unnumbered': 'true' } : {}, 0];
		}
	} as NodeSpec,

	code_block: {
		content: 'text*',
		marks: '',
		group: 'block',
		attrs: {
			// '' = no language recorded: plain text, and the settings popover shows no chip. The old
			// 'Markdown' default painted markdown colours over every fresh verbatim block.
			lang: { default: '' },
			// which verbatim-family environment this came from (verbatim/lstlisting/minted) and its
			// verbatim args, so the serializer reconstructs the same environment
			env: { default: 'verbatim' },
			args: { default: '' }
		},
		code: true,
		defining: true,
		parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
		toDOM() {
			return preDOM;
		}
	} as NodeSpec,

	/** raw LaTeX block, passed through unchanged. */
	raw_latex: {
		content: 'text*',
		marks: '',
		group: 'block',
		code: true,
		defining: true,
		parseDOM: [{ tag: 'div.raw-latex-block', preserveWhitespace: 'full' }],
		toDOM() {
			return ['div', { class: 'raw-latex-block' }, ['code', 0]];
		}
	} as NodeSpec,

	// a cross-document include, rendered as a clickable chip (IncludeDocView). `command` keeps
	// which of \input/\include/\subfile was used so it round-trips exactly
	includedoc: {
		group: 'block',
		atom: true,
		selectable: true,
		attrs: {
			path: { default: '' },
			command: { default: 'input' }
		},
		parseDOM: [
			{
				tag: 'div.includedoc-node',
				getAttrs(dom: HTMLElement) {
					return {
						path: dom.getAttribute('data-path') || '',
						command: dom.getAttribute('data-command') || 'input'
					};
				}
			}
		],
		toDOM(node) {
			return ['div', { class: 'includedoc-node', 'data-path': node.attrs.path, 'data-command': node.attrs.command }];
		}
	} as NodeSpec,

	// sourceForm remembers whether the file used \begin{abstract} ('env') or \abstract{} ('macro')
	// so it round-trips in the original shape
	abstract: {
		content: 'block+',
		group: 'block',
		defining: true,
		attrs: {
			sourceForm: { default: 'env' }
		},
		parseDOM: [
			{
				tag: 'div.abstract',
				getAttrs(dom: HTMLElement) {
					return { sourceForm: dom.getAttribute('data-source-form') || 'env' };
				}
			}
		],
		toDOM(node) {
			return ['div', { class: 'abstract', 'data-source-form': node.attrs.sourceForm }, 0];
		}
	} as NodeSpec,

	// any environment without special handling wraps into this so its body stays editable
	environment: {
		content: 'block+',
		group: 'block',
		defining: true,
		allowGapCursor: true,
		attrs: {
			name: { default: 'environment' },
			// verbatim \begin{name} arguments ("[t]{0.4\linewidth}") so argument-taking environments
			// (minipage, wrapfigure, ...) don't lose args or leak them into the body
			args: { default: '' }
		},
		parseDOM: [
			{
				tag: 'div.tex-environment',
				getAttrs(dom: HTMLElement) {
					return { name: dom.getAttribute('data-env') || 'environment', args: dom.getAttribute('data-args') || '' };
				}
			}
		],
		toDOM(node) {
			return ['div', { class: 'tex-environment', 'data-env': node.attrs.name, 'data-args': node.attrs.args }, 0];
		}
	} as NodeSpec,

	block_math: {
		content: 'text*',
		group: 'block',
		marks: '',
		inline: false,
		code: true,
		defining: true,
		atom: true,
		allowGapCursor: true,
		attrs: {
			label: { default: null },
			numbered: { default: false },
			environment: { default: null }, // 'align' | 'gather' | 'alignat' | null
			lineLabels: { default: [] } // per-line labels for multi-line environments
		},
		toDOM: (node) => {
			return [
				'div',
				{
					class: 'block-math',
					'data-label': node.attrs.label,
					'data-numbered': node.attrs.numbered,
					'data-environment': node.attrs.environment,
					'data-line-labels': JSON.stringify(node.attrs.lineLabels || [])
				},
				0
			];
		},
		parseDOM: [
			{
				tag: 'div.block-math',
				getAttrs: (dom: HTMLElement) => ({
					label: dom.getAttribute('data-label'),
					numbered: dom.getAttribute('data-numbered') === 'true',
					environment: dom.getAttribute('data-environment') || null,
					lineLabels: JSON.parse(dom.getAttribute('data-line-labels') || '[]')
				})
			}
		]
	} as NodeSpec,

	text: {
		group: 'inline'
	} as NodeSpec,

	// BASE spec only: updateImageNode (bottom of this file) replaces it wholesale, and the
	// effective node is a block figure with caption content. this entry just puts the node
	// in the initial OrderedMap
	image: {
		inline: true,
		attrs: {
			src: {},
			alt: { default: null },
			title: { default: null },
			label: { default: null },
			numbered: { default: true },
			showCaption: { default: true },
			spanning: { default: false }, // figure* for multi-column documents
			// verbatim \includegraphics optional args ("width=\textwidth, trim=0 0 0 36, clip") so the
			// image keeps its exact size/crop. '' = source had no [..]; null = editor-created (default width)
			options: { default: null },
			// for imported figures: the whole \begin{figure}...\end{figure} verbatim with the
			// \includegraphics/\caption/\label swapped for sentinel tokens, so surrounding scaffolding
			// (\centerline, \captionsetup, placement, custom macros) round-trips untouched.
			// null = editor-created (standard figure generator)
			figureTemplate: { default: null },
			// true for a bare \includegraphics that was NOT inside a figure float (common inside
			// minipage layouts using \captionof). without it the serializer would wrap the image in a
			// synthesized \begin{figure}, and a float nested in a minipage is often a compile error
			bareOriginal: { default: false },
			// verbatim short-caption arg of \caption[short]{long}, brackets excluded. the slot
			// mechanism replaces the whole \caption, and dropping [short] makes the caption package's
			// argument scanner choke fatally on the next bracket-less \caption. not editable
			captionOpt: { default: null }
		},
		group: 'inline',
		draggable: true,
		parseDOM: [
			{
				tag: 'img[src]',
				getAttrs(dom: HTMLElement) {
					return {
						src: dom.getAttribute('src'),
						title: dom.getAttribute('title'),
						alt: dom.getAttribute('alt'),
						label: dom.getAttribute('data-label'),
						numbered: dom.getAttribute('data-numbered') !== 'false',
						showCaption: dom.getAttribute('data-show-caption') !== 'false',
						spanning: dom.getAttribute('data-spanning') === 'true'
					};
				}
			}
		],
		toDOM(node) {
			const { src, alt, title, label, numbered, showCaption, spanning } = node.attrs;
			return [
				'img',
				{
					src,
					alt,
					title,
					'data-label': label,
					'data-numbered': numbered ? 'true' : 'false',
					'data-show-caption': showCaption ? 'true' : 'false',
					'data-spanning': spanning ? 'true' : 'false'
				}
			];
		}
	} as NodeSpec,

	hard_break: {
		inline: true,
		group: 'inline',
		selectable: false,
		// true = a \\ forced break. false is a legacy value kept so stale docs don't crash;
		// it serializes to nothing
		attrs: { lineBreak: { default: true } },
		parseDOM: [{ tag: 'br' }],
		toDOM() {
			return brDOM;
		}
	} as NodeSpec,

	inline_math: {
		content: 'text*',
		group: 'inline',
		marks: '',
		inline: true,
		code: true,
		defining: true,
		atom: true,
		toDOM: () => {
			return [
				'span',
				{
					class: 'inline-math'
				},
				0
			];
		},
		parseDOM: [
			{
				tag: 'span.inline-math'
			}
		],
		leafText: (node) => {
			return `$${node.textContent}$`;
		}
	} as NodeSpec,

	/** inline raw LaTeX (unknown/unhandled macros), passed through unchanged. */
	inline_latex: {
		content: 'text*',
		group: 'inline',
		marks: '',
		inline: true,
		code: true,
		defining: true,
		atom: false,
		toDOM: () => {
			return [
				'code',
				{
					class: 'inline-latex',
					title: 'Raw LaTeX (passed through unchanged)'
				},
				0
			];
		},
		parseDOM: [
			{
				tag: 'code.inline-latex'
			}
		],
		leafText: (node) => {
			return node.textContent;
		}
	} as NodeSpec,
	citation: citationNodeSpec,
	ref: refNodeSpec,

	// caption + table + optional notes; header rows/columns are prosemirror-tables' native
	// table_header nodes
	table_wrapper: {
		content: 'table_caption table table_notes?',
		group: 'block',
		attrs: {
			label: { default: null },
			// a table with several \label{}s keeps the last in `label` (what the reference-manager UI
			// reads) and the rest here, newline-joined, each re-emitted as its own \label{} line
			extraLabels: { default: null },
			showNotes: { default: false },
			spanning: { default: false }, // table* for multi-column documents
			// raw LaTeX that must precede the tabular to affect it (\setlength{\tabcolsep}{...}),
			// round-tripped verbatim as a prefix
			preBody: { default: null },
			// raw LaTeX after the tabular that isn't notes prose (a trailing \vskip spacer),
			// round-tripped verbatim and kept OUT of the notes wrapper's \small styling
			postBody: { default: null },
			// float placement specifier. [H] (float package) forces placement while [h] is only a
			// hint, so preserve whichever the source had; [h] is the default only for a brand new
			// editor-created table
			placement: { default: '[h]' }
		},
		parseDOM: [
			{
				tag: 'div[data-table-wrapper]',
				getAttrs: (dom: HTMLElement) => ({
					label: dom.getAttribute('data-label'),
					extraLabels: dom.getAttribute('data-extra-labels'),
					showNotes: dom.getAttribute('data-show-notes') === 'true',
					spanning: dom.getAttribute('data-spanning') === 'true',
					preBody: dom.getAttribute('data-pre-body'),
					postBody: dom.getAttribute('data-post-body'),
					placement: dom.getAttribute('data-placement')
				})
			}
		],
		toDOM(node) {
			return [
				'div',
				{
					'data-table-wrapper': '',
					'data-label': node.attrs.label,
					'data-extra-labels': node.attrs.extraLabels,
					'data-show-notes': node.attrs.showNotes,
					'data-spanning': node.attrs.spanning ? 'true' : 'false',
					'data-pre-body': node.attrs.preBody,
					'data-post-body': node.attrs.postBody,
					'data-placement': node.attrs.placement,
					class: 'table-wrapper'
				},
				0
			];
		}
	} as NodeSpec,

	table_caption: {
		content: 'inline*',
		parseDOM: [{ tag: 'div[data-table-caption]' }],
		toDOM() {
			return ['div', { 'data-table-caption': '', class: 'table-caption' }, 0];
		}
	} as NodeSpec,

	table_notes: {
		content: 'inline*',
		parseDOM: [{ tag: 'div[data-table-notes]' }],
		toDOM() {
			return ['div', { 'data-table-notes': '', class: 'table-notes' }, 0];
		}
	} as NodeSpec,

	list: createListSpec(),
	...tableNodeSpecs
};

// raw LaTeX between \begin{itemize} and the first \item (\setlength\itemsep{0pt} setup is
// common). the list node models one PM node per \item, so this has nowhere else to live:
// carried verbatim on the FIRST list node of the group, spliced back after \begin{...}
nodes.list.attrs = { ...(nodes.list.attrs ?? {}), preBody: { default: null } };

// verbatim source preservation: every block the importer can emit at the top level carries
// orig: { latex, norm, pre, seq, start, group* }. latex = original slice; norm = its parse-time
// deterministic serialization; pre = inter-block source; seq = pristine top-level index;
// start = body-relative offset (positional consumers like scroll sync); group* set when one
// construct became several blocks (itemize = one list node per item) so substitution is
// all-or-nothing. the serializer re-emits `latex` only while the block still serializes to
// exactly `norm`, so a stale slice can never overwrite an edit. default null: editor-created
// nodes always go through the deterministic rules. (image gets its orig in updateImageNode)
const ORIG_BLOCKS = [
	'paragraph',
	'blockquote',
	'horizontal_rule',
	'heading',
	'code_block',
	'raw_latex',
	'includedoc',
	'abstract',
	'environment',
	'block_math',
	'table_wrapper',
	'table', // a bare tabular (no float wrapper) imports as a bare table at the top level
	'list'
] as const;
for (const name of ORIG_BLOCKS) {
	const spec = (nodes as Record<string, NodeSpec>)[name];
	spec.attrs = { ...(spec.attrs ?? {}), orig: { default: null } };
}
