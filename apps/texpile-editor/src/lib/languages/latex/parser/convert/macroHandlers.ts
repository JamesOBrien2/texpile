// per-macro conversion handlers and the small node factories they share
// mutually recursive with the walkers in converter.ts; ESM live bindings make the circular import safe
import type { Macro, Environment } from '@unified-latex/unified-latex-types';
import { printRaw } from '@unified-latex/unified-latex-util-print-raw';
import { getTextContent, getMacroFirstArg } from '../ast-utils';
import { el, txt, txtNodes, createDefaultContext, type PmNode, type ConversionContext, type ConversionOptions } from '../builders';
import { convertNodesToInline } from './inlineConvert';

export type MacroHandler = (macro: Macro, ctx: ConversionContext) => PmNode[] | null;

export const macroHandlers: Record<string, MacroHandler> = {
	textbf: (macro, ctx) => {
		const content = getMacroFirstArg(macro);
		const newCtx = { ...ctx, marks: [...ctx.marks, { type: 'strong' }] };
		return convertNodesToInline(content, newCtx);
	},
	textit: (macro, ctx) => {
		const content = getMacroFirstArg(macro);
		const newCtx = { ...ctx, marks: [...ctx.marks, { type: 'em' }] };
		return convertNodesToInline(content, newCtx);
	},
	emph: (macro, ctx) => {
		const content = getMacroFirstArg(macro);
		const newCtx = { ...ctx, marks: [...ctx.marks, { type: 'em' }] };
		return convertNodesToInline(content, newCtx);
	},
	underline: (macro, ctx) => {
		const content = getMacroFirstArg(macro);
		const newCtx = { ...ctx, marks: [...ctx.marks, { type: 'u' }] };
		return convertNodesToInline(content, newCtx);
	},
	texttt: (macro, ctx) => {
		const content = getMacroFirstArg(macro);
		const newCtx = { ...ctx, marks: [...ctx.marks, { type: 'code' }] };
		return convertNodesToInline(content, newCtx);
	},
	textsuperscript: (macro, ctx) => {
		const content = getMacroFirstArg(macro);
		const newCtx = { ...ctx, marks: [...ctx.marks, { type: 'sup' }] };
		return convertNodesToInline(content, newCtx);
	},
	// command-form \abstract{...}: wrap the inline content in one paragraph (the abstract node's
	// schema wants block+), stamp sourceForm:'macro' so it round-trips as the command form.
	abstract: (macro, ctx) => {
		const content = getMacroFirstArg(macro);
		const inline = convertNodesToInline(content, ctx);
		return [el('abstract', { sourceForm: 'macro' }, [el('paragraph', null, inline)])];
	},
	textsubscript: (macro, ctx) => {
		const content = getMacroFirstArg(macro);
		const newCtx = { ...ctx, marks: [...ctx.marks, { type: 'sub' }] };
		return convertNodesToInline(content, newCtx);
	},
	verb: (macro) => {
		const content = getTextContent(getMacroFirstArg(macro));
		return txtNodes(content, [{ type: 'code' }]);
	},

	textcolor: (macro, ctx) => {
		if (!macro.args || macro.args.length < 2) return null;
		const mandatoryArgs = macro.args.filter((arg) => arg.openMark === '{');
		if (mandatoryArgs.length < 2) return null;
		const color = getTextContent(mandatoryArgs[0].content);
		const content = mandatoryArgs[1].content;
		const newCtx = { ...ctx, marks: [...ctx.marks, { type: 'textcolor', attrs: { color } }] };
		return convertNodesToInline(content, newCtx);
	},
	colorbox: (macro, ctx) => {
		if (!macro.args || macro.args.length < 2) return null;
		const mandatoryArgs = macro.args.filter((arg) => arg.openMark === '{');
		if (mandatoryArgs.length < 2) return null;
		const color = getTextContent(mandatoryArgs[0].content);
		const content = mandatoryArgs[1].content;
		const newCtx = { ...ctx, marks: [...ctx.marks, { type: 'highlight', attrs: { color } }] };
		return convertNodesToInline(content, newCtx);
	},

	url: (macro, ctx) => {
		const href = getTextContent(getMacroFirstArg(macro));
		// bare: true, see the attr's doc comment in schema.ts / applyMarks in latexSerializer.ts.
		return txtNodes(href, [...ctx.marks, { type: 'link', attrs: { href, title: null, bare: true } }]);
	},
	href: (macro, ctx) => {
		const mandatoryArgs = macro.args?.filter((arg) => arg.openMark === '{') || [];
		const href = mandatoryArgs[0] ? getTextContent(mandatoryArgs[0].content) : '';
		const text = mandatoryArgs[1] ? getTextContent(mandatoryArgs[1].content) : href;
		return txtNodes(text, [...ctx.marks, { type: 'link', attrs: { href, title: null } }]);
	},

	section: (macro) => createHeading(macro, 1),
	subsection: (macro) => createHeading(macro, 2),
	subsubsection: (macro) => createHeading(macro, 3),
	paragraph: (macro) => createHeading(macro, 4),
	subparagraph: (macro) => createHeading(macro, 5),
	chapter: (macro) => createHeading(macro, 1),
	part: (macro) => createHeading(macro, 1),

	// special characters all pass ctx.marks through: they're ordinary inline content, often
	// inside \textbf{...} (\textbf{90.1\%}); without this the enclosing mark silently dropped
	// for exactly that token.
	LaTeX: (_m, ctx) => txtNodes('LaTeX', ctx.marks.length > 0 ? ctx.marks : null),
	TeX: (_m, ctx) => txtNodes('TeX', ctx.marks.length > 0 ? ctx.marks : null),
	'\\': () => [el('hard_break', { lineBreak: true })], // serializes back to \\
	newline: () => [el('hard_break', { lineBreak: true })],
	'%': (_m, ctx) => txtNodes('%', ctx.marks.length > 0 ? ctx.marks : null),
	'&': (_m, ctx) => txtNodes('&', ctx.marks.length > 0 ? ctx.marks : null),
	$: (_m, ctx) => txtNodes('$', ctx.marks.length > 0 ? ctx.marks : null),
	'#': (_m, ctx) => txtNodes('#', ctx.marks.length > 0 ? ctx.marks : null),
	_: (_m, ctx) => txtNodes('_', ctx.marks.length > 0 ? ctx.marks : null),
	'{': (_m, ctx) => txtNodes('{', ctx.marks.length > 0 ? ctx.marks : null),
	'}': (_m, ctx) => txtNodes('}', ctx.marks.length > 0 ? ctx.marks : null),
	textbackslash: (_m, ctx) => txtNodes('\\', ctx.marks.length > 0 ? ctx.marks : null),
	'~': (_m, ctx) => txtNodes('\u00A0', ctx.marks.length > 0 ? ctx.marks : null),
	ldots: (_m, ctx) => txtNodes('…', ctx.marks.length > 0 ? ctx.marks : null),
	dots: (_m, ctx) => txtNodes('…', ctx.marks.length > 0 ? ctx.marks : null),
	textendash: (_m, ctx) => txtNodes('–', ctx.marks.length > 0 ? ctx.marks : null),
	textemdash: (_m, ctx) => txtNodes('—', ctx.marks.length > 0 ? ctx.marks : null),

	quad: (_m, ctx) => txtNodes('  ', ctx.marks.length > 0 ? ctx.marks : null),
	qquad: (_m, ctx) => txtNodes('    ', ctx.marks.length > 0 ? ctx.marks : null),
	',': (_m, ctx) => txtNodes(' ', ctx.marks.length > 0 ? ctx.marks : null), // thin space
	';': (_m, ctx) => txtNodes(' ', ctx.marks.length > 0 ? ctx.marks : null), // medium space
	':': (_m, ctx) => txtNodes(' ', ctx.marks.length > 0 ? ctx.marks : null), // thick space
	'!': () => null, // negative thin space
	// spacing commands (\vspace, \hspace, \vfill, ...) are deliberately NOT handled here: they
	// affect layout, so they fall through to raw inline_latex and round-trip verbatim.
	indent: () => null, // a leading indent the editor models implicitly; no visible token

	// size/series/shape switches are NOT dropped either: they fall through to raw, and a {...}
	// group scoping one is kept whole (see SCOPED_SWITCHES / the 'group' case).

	defbibheading: () => null,
	addbibresource: () => null,

	// NB: no `label` handler: table_wrapper/figure/block_math capture their own labels; any other
	// \label falls through to raw so it's preserved (a dropped label silently breaks \ref/\cref).
	def: () => null, // \def\x{...} has no safe arg signature yet, leave for a follow-up
	let: () => null,
	ifdefempty: () => null,

	// \par flushes the current paragraph (null signals it)
	par: () => null,

	hrule: () => [el('horizontal_rule')],
	// \rule{\linewidth}{0.4pt} is exactly what our horizontal_rule emits, so map it back. any
	// other \rule is a sized box/strut (e.g. row-height struts): preserve verbatim rather than
	// collapse to a generic full-width line (which also compounded).
	rule: (macro) => {
		const dims = (macro.args ?? []).filter((a) => a.openMark === '{').map((a) => printRaw(a.content).trim());
		if (dims.length === 2 && dims[0] === '\\linewidth' && dims[1] === '0.4pt') return [el('horizontal_rule')];
		// strip a swallowed trailing \par; (?![a-zA-Z]) is TeX's control-word terminator, so
		// \paragraph can never false-match.
		const rawLatex = printRaw(macro).replace(/\s*\\par(?![a-zA-Z])\s*$/, '');
		return [el('inline_latex', null, [txt(rawLatex)])];
	},

	// the original command is carried through (createCitation reads macro.content) so
	// \citep/\citet/... round-trip instead of collapsing to \autocite.
	cite: (macro) => createCitation(macro),
	citep: (macro) => createCitation(macro),
	citet: (macro) => createCitation(macro),
	parencite: (macro) => createCitation(macro),
	textcite: (macro) => createCitation(macro),
	autocite: (macro) => createCitation(macro),
	footcite: (macro) => createCitation(macro),

	ref: (macro) => createRef(macro, null),
	eqref: (macro) => createRef(macro, 'equation'),
	pageref: (macro) => createRef(macro, 'page'),
	autoref: (macro) => createRef(macro, null),
	cref: (macro) => createRef(macro, null),
	Cref: (macro) => createRef(macro, null),

	// every \vspace round-trips verbatim as a raw chip, including \vspace{\baselineskip} (no
	// longer the editor's blank-line protocol; one someone typed is real spacing).
	vspace: (macro) => {
		// lexical trailing-\par strip, same as the `rule` handler
		const rawLatex = printRaw(macro).replace(/\s*\\par(?![a-zA-Z])\s*$/, '');
		return [el('inline_latex', null, [txt(rawLatex)])];
	},

	// \input/\include/\subfile: a clickable chip; path kept verbatim, `command` records which
	// form was used so it serializes back exactly.
	input: (macro) => createIncludeDoc(macro),
	include: (macro) => createIncludeDoc(macro),
	subfile: (macro) => createIncludeDoc(macro),

	// KNOWN GAP: the filename is flattened via getTextContent, so a nested macro call
	// (\includegraphics{\iftoggle{hq}{a.pdf}{b.pdf}}) loses its structure and concatenates into
	// one bogus path. fixing it needs a raw-source fallback here; deliberately out of scope (rare).
	includegraphics: (macro) => {
		if (!macro.args || macro.args.length === 0) return null;
		let src = '';
		for (let i = macro.args.length - 1; i >= 0; i--) {
			const arg = macro.args[i];
			if (arg.openMark === '{' && arg.closeMark === '}') {
				src = getTextContent(arg.content);
				break;
			}
		}
		if (!src && macro.args.length > 0) {
			src = getTextContent(macro.args[macro.args.length - 1].content);
		}
		// preserve the verbatim optional args so the image keeps its exact size/crop.
		const optArg = macro.args.find((a) => a.openMark === '[');
		// '' (not null) records "the source had no [..]" so the serializer emits bracket-free;
		// null is reserved for editor-created images (which want the default width).
		const options = optArg ? printRaw(optArg.content) : '';
		// bareOriginal: this handler only runs for a STANDALONE \includegraphics (figures go via
		// createFigureWrapper), so regeneration must not synthesize a figure wrapper. see schema.ts.
		return [el('image', { src, alt: null, title: null, label: null, options, bareOriginal: true })];
	}

	// \footnote is NOT inlined as "[text]": that reflows the document and drops the real
	// page-bottom footnote. it falls through to raw and round-trips whole.

	// \title/\author/\date/\maketitle fall through to raw whole (with \thanks and the \And
	// grid): dropping them made \maketitle rebuild a wrong-height block, shifting the page.
};

/** True if a macro carries a star argument (e.g. `\section*`), parsed via the `s` signature. */
export function macroHasStar(macro: Macro): boolean {
	return (macro.args ?? []).some(
		(arg) => arg.content?.length === 1 && arg.content[0]?.type === 'string' && (arg.content[0] as { content?: string }).content === '*'
	);
}

export function createHeading(macro: Macro, level: number): PmNode[] {
	const content = getMacroFirstArg(macro);
	const textNodes = convertNodesToInline(content, createDefaultContext());
	// starred sectioning commands (\section*) are unnumbered
	const numbered = !macroHasStar(macro);
	return [el('heading', { level, numbered }, textNodes)];
}

export function createIncludeDoc(macro: Macro): PmNode[] | null {
	// keep the path exactly as written (LaTeX resolves the .tex extension itself)
	const mandatoryArgs = macro.args?.filter((arg) => arg.openMark === '{') || [];
	const path = mandatoryArgs[0] ? getTextContent(mandatoryArgs[0].content).trim() : '';
	if (!path) return null; // no argument captured: let it fall through to raw
	const command = typeof macro.content === 'string' && macro.content ? macro.content : 'input';
	return [el('includedoc', { path, command })];
}

export function createCitation(macro: Macro): PmNode[] {
	const optionalArgs = macro.args?.filter((arg) => arg.openMark === '[') || [];
	const mandatoryArgs = macro.args?.filter((arg) => arg.openMark === '{') || [];

	const key = mandatoryArgs[0] ? getTextContent(mandatoryArgs[0].content) : '';

	// [pre-note][post-note], or just [post-note]
	let prenote = '';
	let postnote = '';
	if (optionalArgs.length === 2) {
		prenote = getTextContent(optionalArgs[0].content) || '';
		postnote = getTextContent(optionalArgs[1].content) || '';
	} else if (optionalArgs.length === 1) {
		postnote = getTextContent(optionalArgs[0].content) || '';
	}

	// keep the original command so \citep{x} doesn't come back as \autocite{x}
	const variant = typeof macro.content === 'string' && macro.content ? macro.content : 'autocite';
	return [el('citation', { variant, prenote, postnote }, key ? [txt(key)] : null)];
}

export type EnvHandler = (env: Environment, ctx: ConversionContext, options: ConversionOptions) => PmNode[];

export function createRef(macro: Macro, refType: string | null): PmNode[] {
	const mandatoryArgs = macro.args?.filter((arg) => arg.openMark === '{') || [];
	const label = mandatoryArgs[0] ? getTextContent(mandatoryArgs[0].content) : '';

	// infer the kind from the label prefix if not provided
	let kind = refType;
	if (!kind && label) {
		const lowerLabel = label.toLowerCase();
		if (lowerLabel.startsWith('tab:') || lowerLabel.startsWith('table:') || lowerLabel.includes('texpile-table-')) {
			kind = 'table';
		} else if (lowerLabel.startsWith('fig:') || lowerLabel.startsWith('figure:') || lowerLabel.includes('texpile-fig-')) {
			kind = 'figure';
		} else if (lowerLabel.startsWith('eq:') || lowerLabel.startsWith('equation:') || lowerLabel.includes('texpile-eq-')) {
			kind = 'equation';
		}
	}

	// keep the original command (ref/eqref/cref/...) so it round-trips instead of normalising
	// to \autoref.
	const command = typeof macro.content === 'string' && macro.content ? macro.content : 'autoref';
	// unknown target kind: the general 'reference' type
	return [el('ref', { refType: kind ?? 'reference', command }, label ? [txt(label)] : null)];
}

// only `document` is truly transparent: center/flushleft/flushright change the rendered
// alignment, so they stay as `environment` nodes.
