// tabular/table environments to PM table nodes: components, spans, rules, placeholder cells
// mutually recursive with the walkers in converter.ts; ESM live bindings make the circular import safe
import type { Node, Macro, Environment } from '@unified-latex/unified-latex-types';
import { printRaw } from '@unified-latex/unified-latex-util-print-raw';
import { getTextContent, getMacroFirstArg } from '../ast-utils';
import {
	buildNode,
	textNode,
	nodeToLatexString,
	createDefaultContext,
	type PmNode,
	type ConversionContext,
	type ConversionOptions
} from '../builders';
import { SCOPED_SWITCHES, FONT_SIZE_SWITCHES } from '../macros';
import { convertNodesToBlocks } from '../converter';
import { convertNodesToInline } from './inlineConvert';
import { nodeRawSource } from './origCapture';

function extractTableComponents(content: Node[], ctx: ConversionContext) {
	let caption: PmNode | null = null;
	// collect ALL labels: the last stays primary (single-label case unchanged, and reference-
	// manager UI reads `label` as one bare id), earlier ones round-trip via extraLabels.
	// overwriting on each occurrence silently dropped every label but the last.
	const labels: string[] = [];
	const tables: PmNode[] = [];
	const notes: PmNode[] = [];

	// preNodes (setup like \setlength{\tabcolsep}{4pt} that must precede the tabular) round-trip
	// as a raw prefix (preBody); noteNodes (after the tabular) become editable table_notes.
	const preNodes: Node[] = [];
	let noteNodes: Node[] = [];
	let sawTabular = false;

	for (const node of content) {
		if (node.type === 'macro' && node.content === 'caption') {
			const arg = getMacroFirstArg(node as Macro);
			const captionText = convertNodesToInline(arg, ctx);
			caption = buildNode('table_caption', null, captionText);
		} else if (node.type === 'macro' && node.content === 'label') {
			const text = getTextContent(getMacroFirstArg(node as Macro));
			if (text) labels.push(text);
		} else if (node.type === 'environment' && (node.env === 'tabular' || node.env === 'tabularx' || node.env === 'longtable')) {
			sawTabular = true;
			if (node.env === 'tabular') tables.push(...createTable(node as Environment));
			else if (node.env === 'tabularx') tables.push(...createTable(node as Environment));
			else if (node.env === 'longtable') tables.push(...createTable(node as Environment));
		} else {
			// whitespace BEFORE the tabular is just separation (preBody re-joins with spaces);
			// whitespace AFTER is preserved (word spacing in notes prose matters).
			if (node.type === 'parbreak' || (node.type === 'whitespace' && !sawTabular)) continue;
			if (node.type === 'macro' && (node.content === 'centering' || node.content === 'vspace' || node.content === 'raggedright')) continue;
			// the notes serializer emits its own {\small ...}, so a size switch in the NOTES
			// position is redundant and compounds each save: strip a bare one, unwrap a group led
			// by one. must stay scoped to sawTabular: a switch BEFORE the tabular (\scriptsize to
			// shrink an oversized table) has nothing to do with the notes wrapper and must survive.
			if (sawTabular && node.type === 'macro' && FONT_SIZE_SWITCHES.has((node as Macro).content)) continue;
			if (sawTabular && node.type === 'group') {
				const gcontent: Node[] = node.content || [];
				const firstMeaningful = gcontent.find((n) => !(n.type === 'whitespace' || n.type === 'parbreak' || n.type === 'comment'));
				if (firstMeaningful && firstMeaningful.type === 'macro' && FONT_SIZE_SWITCHES.has((firstMeaningful as Macro).content)) {
					noteNodes.push(...gcontent.filter((n) => n !== firstMeaningful));
					continue;
				}
			}

			(sawTabular ? noteNodes : preNodes).push(node);
		}
	}

	// preBody is plumbing, not prose the user edits: round-trip raw (byte-sliced when possible)
	const preBody =
		preNodes.length > 0
			? preNodes
					.map((n) => nodeRawSource(n) ?? printRaw(n))
					.join(' ')
					.trim() || null
			: null;

	// trim whitespace-only edges before deciding notes exist, or the near-universal newline
	// between \end{tabular} and \end{table} earns every table a spurious empty {\small } wrapper
	// (visible extra vertical space).
	while (noteNodes.length && noteNodes[0].type === 'whitespace') noteNodes.shift();
	while (noteNodes.length && noteNodes[noteNodes.length - 1].type === 'whitespace') noteNodes.pop();

	// a \vskip/\hskip or scoped switch after the tabular is setup, not prose, but the notes
	// wrapper emits \par\smallskip{\small ...} around whatever lands in noteNodes: extra vertical
	// space for a bare \vskip, and {\small \normalsize} literally re-shrinks the text that
	// command exists to un-shrink. round-trip it raw as postBody instead, scoped to when it
	// STARTS the post-tabular content; real notes after a leading switch keep the \small treatment.
	let postBody: string | null = null;
	const firstNote = noteNodes.find((n) => n.type !== 'whitespace' && n.type !== 'parbreak');
	if (
		firstNote &&
		firstNote.type === 'macro' &&
		((firstNote as Macro).content === 'vskip' ||
			(firstNote as Macro).content === 'hskip' ||
			SCOPED_SWITCHES.has((firstNote as Macro).content))
	) {
		postBody =
			noteNodes
				.map((n) => nodeRawSource(n) ?? printRaw(n))
				.join(' ')
				.trim() || null;
		noteNodes = [];
	}

	if (noteNodes.length > 0) {
		const convertedNotes = convertNodesToInline(noteNodes, ctx);
		if (convertedNotes.length > 0) {
			notes.push(buildNode('table_notes', null, convertedNotes));
		}
	}

	const label = labels.length > 0 ? labels[labels.length - 1] : null;
	const extraLabels = labels.length > 1 ? labels.slice(0, -1) : null;

	return { caption, label, extraLabels, tables, notes, preBody, postBody };
}

/** Whether a tabular/tabularx/longtable appears anywhere (possibly nested) in these nodes. */
export function containsTabular(nodes: Node[]): boolean {
	for (const n of nodes) {
		if (n.type === 'environment' && (n.env === 'tabular' || n.env === 'tabular*' || n.env === 'tabularx' || n.env === 'longtable'))
			return true;
		if ('content' in n && Array.isArray(n.content) && containsTabular(n.content)) return true;
	}
	return false;
}

export function createTableWrapper(env: Environment, ctx: ConversionContext, options: ConversionOptions): PmNode[] {
	const { caption, label, extraLabels, tables, notes, preBody, postBody } = extractTableComponents(env.content, ctx);

	const tableNode = tables[0];
	if (!tableNode) {
		// no tabular as a DIRECT child. one merely nested (e.g. in \begin{center}) still becomes
		// editable: keep the float as an environment node, the nested tabular converts inside it.
		if (containsTabular(env.content)) {
			const envArgs = (env as Environment).args && (env as Environment).args!.length ? printRaw((env as Environment).args!) : '';
			const inner = convertNodesToBlocks(env.content, options);
			return [buildNode('environment', { name: env.env, args: envArgs }, inner.length > 0 ? inner : [buildNode('paragraph')])];
		}
		// genuinely unmodellable (tabulary, tabu, ...): block-parsing would inject an illegal
		// \par and mangle the column spec, so preserve the whole float verbatim.
		return [buildNode('raw_latex', null, [textNode(nodeRawSource(env) ?? nodeToLatexString(env))])];
	}

	// the float's own placement specifier ([t], [H], or '' when the source had none), round-
	// tripped verbatim: [H] FORCES placement while [h] is advisory, so silently downgrading one
	// to the other can move the table to a different page.
	const placement = env.args && env.args.length ? printRaw(env.args) : '';

	return [
		buildNode(
			'table_wrapper',
			{
				label: label,
				extraLabels: extraLabels ? extraLabels.join('\n') : null,
				showNotes: notes.length > 0,
				preBody,
				postBody,
				placement,
				hasHeaderRow: true, // simplified assumption
				hasHeaderColumn: true,
				// table_wrapper has no verbatim template; \begin{table}/table* is ALWAYS
				// synthesized from this attr, without it a table* loses its two-column span.
				spanning: env.env === 'table*'
			},
			[caption || buildNode('table_caption'), tableNode, ...notes]
		)
	];
}

// sentinels for the editable pieces inside a stored figureTemplate; substituted on save, they
// never reach a compiler and can't collide with real macros.

export const TABLE_RULE_MACROS = new Set([
	'hline',
	'cline',
	'toprule',
	'midrule',
	'bottomrule',
	'cmidrule',
	'hhline',
	'specialrule',
	'addlinespace',
	'morecmidrules'
]);

/**
 * A tabular row break (`\\`). unified-latex gives it a `content` of '\\' OR the whitespace it
 * swallowed ('\n' at end of line, ' ' before `\hline`); matching only '\\' silently merged every
 * row into one. limitation: a `\ ` control space parses to the identical macro, so an in-cell
 * `\ ` is also treated as a row break (rare in tables; accepted).
 */
export function isRowBreak(macro: Macro): boolean {
	const c = (macro as Macro).content;
	return c === '\\' || (typeof c === 'string' && c.length > 0 && /^\s+$/.test(c));
}

export function createTable(env: Environment): PmNode[] {
	// capture the EXACT architecture so the table re-serializes render-identically: env name,
	// column spec, width, and \hline-family rules.
	const mandatory = (env.args ?? []).filter((a) => a.openMark === '{');
	// tabularx/tabulary/tabular* take a leading {width} before the column spec
	const takesWidth = env.env === 'tabularx' || env.env === 'tabulary' || env.env === 'tabular*';
	const tabularxWidth = takesWidth && mandatory.length >= 2 ? printRaw(mandatory[0].content) : null;
	const colspecArg = takesWidth ? mandatory[1] : mandatory[mandatory.length - 1];
	const colspec = colspecArg ? printRaw(colspecArg.content) : null;

	const rows: PmNode[] = [];
	let currentRowCells: PmNode[] = [];
	let currentCellContent: Node[] = [];
	let pendingRules = ''; // rules seen since the last row, not yet assigned
	let rowTop = ''; // the rules that precede the row currently being built
	let rowStarted = false;

	// A row "starts" at its first meaningful content / `&`; rules before that are its topRules.
	function startRow() {
		if (!rowStarted) {
			rowStarted = true;
			rowTop = pendingRules;
			pendingRules = '';
		}
	}
	function flushRow(cells: PmNode[]) {
		rows.push(buildNode('table_row', { topRules: rowTop }, cells.length > 0 ? cells : [createTableCell([])]));
		rowTop = '';
		rowStarted = false;
	}

	for (const node of env.content) {
		if (node.type === 'string' && node.content === '&') {
			startRow();
			currentRowCells.push(createTableCell(currentCellContent));
			currentCellContent = [];
		} else if (node.type === 'macro' && isRowBreak(node as Macro)) {
			startRow();
			currentRowCells.push(createTableCell(currentCellContent));
			flushRow(currentRowCells);
			currentRowCells = [];
			currentCellContent = [];
		} else if (node.type === 'macro' && TABLE_RULE_MACROS.has((node as Macro).content)) {
			pendingRules += printRaw(node);
		} else if (!rowStarted && node.type === 'macro' && ((node as Macro).content === 'rule' || (node as Macro).content === 'hrule')) {
			// a \rule strut before any cell content is row-leading decoration (row-height struts):
			// capture it with topRules or it becomes a horizontal_rule in the first cell and compounds.
			pendingRules += printRaw(node);
		} else {
			const blank =
				node.type === 'whitespace' ||
				node.type === 'parbreak' ||
				node.type === 'comment' ||
				(node.type === 'macro' && (node as Macro).content === 'par');
			if (!blank) startRow();
			currentCellContent.push(node);
		}
	}

	const isOnlyWhitespace = currentCellContent.every(
		(n) =>
			n.type === 'whitespace' ||
			n.type === 'parbreak' ||
			n.type === 'comment' ||
			(n.type === 'macro' && (n as Macro).content === 'par') ||
			(n.type === 'string' && (n.content || '').trim() === '')
	);
	if ((!isOnlyWhitespace || currentRowCells.length > 0) && (currentCellContent.length > 0 || currentRowCells.length > 0)) {
		startRow();
		currentRowCells.push(createTableCell(currentCellContent));
		flushRow(currentRowCells);
	}
	const bottomRules = pendingRules; // rules after the final row

	if (rows.length === 0) {
		rows.push(buildNode('table_row', null, [createTableCell([])]));
	}

	return [buildNode('table', { env: env.env, colspec, tabularxWidth, bottomRules }, resolveSpans(rows))];
}

// a node that contributes no cell content (whitespace / comments / empty strings)
export function isBlankCellNode(n: Node): boolean {
	return (
		n.type === 'whitespace' ||
		n.type === 'parbreak' ||
		n.type === 'comment' ||
		(n.type === 'macro' && (n as Macro).content === 'par') ||
		(n.type === 'string' && ((n as { content?: string }).content || '').trim() === '')
	);
}
export function isMacroNamed(n: Node, name: string): boolean {
	return n.type === 'macro' && (n as Macro).content === name;
}

// detect a leading \multicolumn / \multirow (possibly \multicolumn wrapping \multirow, the shape
// the serializer emits for both-ways spans) and pull out the span counts + actual content.
export function unwrapSpans(content: Node[]): { colspan: number; rowspan: number; inner: Node[] } {
	let colspan = 1;
	let rowspan = 1;
	let inner = content;
	function spanOf(m: Macro): number {
		const a = (m.args ?? []).filter((x) => x.openMark === '{')[0];
		const v = a ? parseInt(printRaw(a.content).trim(), 10) : NaN;
		return Number.isFinite(v) && v > 0 ? v : 1;
	}
	function textOf(m: Macro): Node[] {
		const args = (m.args ?? []).filter((x) => x.openMark === '{');
		return args.length >= 3 ? (args[2].content as Node[]) : inner;
	}
	const meaningful = content.filter((n) => !isBlankCellNode(n));
	if (meaningful.length === 1 && isMacroNamed(meaningful[0], 'multicolumn')) {
		const mc = meaningful[0] as Macro;
		colspan = spanOf(mc);
		inner = textOf(mc);
		const innerMeaningful = inner.filter((n) => !isBlankCellNode(n));
		if (innerMeaningful.length === 1 && isMacroNamed(innerMeaningful[0], 'multirow')) {
			const mr = innerMeaningful[0] as Macro;
			rowspan = spanOf(mr);
			inner = textOf(mr);
		}
	} else if (meaningful.length === 1 && isMacroNamed(meaningful[0], 'multirow')) {
		const mr = meaningful[0] as Macro;
		rowspan = spanOf(mr);
		inner = textOf(mr);
	}
	return { colspan, rowspan, inner };
}

export function createTableCell(content: Node[]): PmNode {
	const { colspan, rowspan, inner } = unwrapSpans(content);
	// trim blank AST nodes BEFORE conversion, not the merged text string after: a macro that
	// produces literal spaces as real content (\quad row-label indents) is indistinguishable from
	// incidental whitespace once flattened, and a string-level trim silently eats it.
	let start = 0;
	let end = inner.length;
	while (start < end && isBlankCellNode(inner[start])) start++;
	while (end > start && isBlankCellNode(inner[end - 1])) end--;
	const ctx = createDefaultContext();
	const inlineContent = convertNodesToInline(inner.slice(start, end), ctx);

	return buildNode('table_cell', { colspan, rowspan, colwidth: null }, [buildNode('paragraph', null, inlineContent)]);
}

// drop the placeholder cells LaTeX writes UNDER a \multirow so the prosemirror-tables covered-
// cell model matches: a spanning cell appears once in its origin row, covered positions are
// omitted below. no-rowspan tables come back unchanged.
export function resolveSpans(rows: PmNode[]): PmNode[] {
	const covered: boolean[][] = [];
	function mark(r: number, c: number) {
		while (covered.length <= r) covered.push([]);
		covered[r][c] = true;
	}
	return rows.map((row, r) => {
		const kept: PmNode[] = [];
		let col = 0;
		row.forEach((cell) => {
			const cs = Number(cell.attrs.colspan ?? 1);
			const rs = Number(cell.attrs.rowspan ?? 1);
			if (covered[r]?.[col]) {
				col += cs; // a placeholder for a rowspan from above: drop it
				return;
			}
			kept.push(cell);
			if (rs > 1) for (let rr = r + 1; rr < r + rs; rr++) for (let cc = col; cc < col + cs; cc++) mark(rr, cc);
			col += cs;
		});
		return buildNode('table_row', { topRules: row.attrs.topRules ?? '' }, kept.length ? kept : [createTableCell([])]);
	});
}

// LaTeX text ligatures to real typographic glyphs. order matters (longest first). applied only
// to plain prose text nodes; \texttt/code keeps -- and `` literal.
