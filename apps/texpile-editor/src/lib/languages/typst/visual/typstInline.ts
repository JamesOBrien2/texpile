// the inline layer: text escaping, mark delimiters, and mark-aware run rendering
import type { Node, Mark } from 'prosemirror-model';
import { latexToTypst } from './latexToTypst';

export function mathTypstOf(node: Node): string {
	const latex = node.textContent;
	const typst = typeof node.attrs.typst === 'string' ? node.attrs.typst : null;
	if (typst != null && latex === node.attrs.latexOrig) return typst;
	return latexToTypst(latex) ?? typst ?? latex;
}

/**
 * Backslash-escape Typst markup structure. `_` stays literal intraword (Typst emphasis only
 * opens at word boundaries, so snake_case is safe); `@` only starts a ref before a word char;
 * `//` would start a comment, so the first slash of a pair is escaped.
 */
export function escTypst(str: string, startOfLine = false): string {
	let out = '';
	for (let i = 0; i < str.length; i++) {
		const ch = str[i];
		if ('\\#$`*[]<~'.includes(ch)) {
			out += '\\' + ch;
			continue;
		}
		if (ch === '_') {
			const intraword = i > 0 && i + 1 < str.length && /\w/.test(str[i - 1]) && /\w/.test(str[i + 1]);
			out += intraword ? ch : '\\_';
			continue;
		}
		if (ch === '@' && /[\p{L}\p{N}_]/u.test(str[i + 1] ?? '')) {
			out += '\\@';
			continue;
		}
		if (ch === '/' && str[i + 1] === '/') {
			out += '\\/';
			continue;
		}
		out += ch;
	}
	if (startOfLine) {
		// list/term/heading markers and "1." enum markers only bind at line start
		out = out.replace(/^[-+/=]/, '\\$&').replace(/^(\d+)\./, '$1\\.');
	}
	return out;
}

/** inline raw with a backtick fence longer than any run inside, padded when the ends collide. */
function codeSpan(text: string): string {
	const runs = text.match(/`+/g);
	const fence = '`'.repeat(runs ? Math.max(...runs.map((r) => r.length)) + 1 : 1);
	const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
	return fence + pad + text + pad + fence;
}

/** typst string literal for a link target; JSON escaping is a compatible subset. */
export function typStr(value: string): string {
	return JSON.stringify(value);
}

type MarkDelims = {
	open: string;
	close: string;
	/** emphasis family: delimiters can't touch whitespace, boundary ws moves outside. */
	expel?: boolean;
};

// typst named colors (shared with the converter's accept list); cyan/magenta are CSS-only names
// the dropdowns can produce, mapped to their rgb forms
const TYP_COLOR_IDENTS = new Set([
	'black',
	'gray',
	'silver',
	'white',
	'navy',
	'blue',
	'aqua',
	'teal',
	'purple',
	'fuchsia',
	'maroon',
	'red',
	'orange',
	'yellow',
	'olive',
	'green',
	'lime'
]);
const CSS_ONLY_COLORS: Record<string, string> = { cyan: '#00ffff', magenta: '#ff00ff' };

/** a mark's CSS color -> a typst color expression, or null when unrepresentable. */
function typColor(css: string): string | null {
	const v = css.trim().toLowerCase();
	if (TYP_COLOR_IDENTS.has(v)) return v;
	const hex = CSS_ONLY_COLORS[v] ?? (/^#[0-9a-f]{3,8}$/.test(v) ? v : null);
	return hex ? `rgb(${JSON.stringify(hex)})` : null;
}

const MARK_DELIMS: Record<string, (attrs: Record<string, unknown>) => MarkDelims> = {
	link: (a) => ({ open: `#link(${typStr(String(a.href ?? ''))})[`, close: ']' }),
	strong: () => ({ open: '*', close: '*', expel: true }),
	em: () => ({ open: '_', close: '_', expel: true }),
	u: () => ({ open: '#underline[', close: ']' }),
	sup: () => ({ open: '#super[', close: ']' }),
	sub: () => ({ open: '#sub[', close: ']' }),
	// an unrepresentable color (a pasted CSS value typst has no name for) drops the wrapper but
	// keeps the content - the color was never expressible in the file
	highlight: (a) => {
		const c = String(a.color ?? 'yellow')
			.trim()
			.toLowerCase();
		if (c === 'yellow') return { open: '#highlight[', close: ']' };
		const t = typColor(c);
		return t ? { open: `#highlight(fill: ${t})[`, close: ']' } : { open: '', close: '' };
	},
	textcolor: (a) => {
		const t = typColor(String(a.color ?? ''));
		return t ? { open: `#text(fill: ${t})[`, close: ']' } : { open: '', close: '' };
	}
};

// canonical nesting order (outermost first); code is innermost and handled inside run content
const MARK_ORDER = ['textcolor', 'highlight', 'u', 'sup', 'sub', 'link', 'strong', 'em'];

function orderedMarks(marks: readonly Mark[]): Mark[] {
	return marks
		.filter((m) => m.type.name !== 'code')
		.sort((a, b) => {
			const ia = MARK_ORDER.indexOf(a.type.name);
			const ib = MARK_ORDER.indexOf(b.type.name);
			return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
		});
}

type InlineRun = {
	content: string;
	marks: Mark[];
	/** plain prose (whitespace expelling applies); false for chips and breaks */
	isText: boolean;
};

function buildRuns(parent: Node, startOfLine: boolean): InlineRun[] {
	const runs: InlineRun[] = [];
	let atLineStart = startOfLine;
	parent.forEach((node) => {
		if (node.isText) {
			if (node.marks.some((m) => m.type.name === 'code')) {
				runs.push({ content: codeSpan(node.text ?? ''), marks: orderedMarks(node.marks), isText: false });
			} else {
				runs.push({ content: escTypst(node.text ?? '', atLineStart), marks: orderedMarks(node.marks), isText: true });
			}
			atLineStart = false;
			return;
		}
		switch (node.type.name) {
			case 'hard_break':
				if (node.attrs?.lineBreak === false) return; // legacy no-op break
				runs.push({ content: '\\\n', marks: [], isText: false });
				atLineStart = true;
				return;
			case 'inline_latex':
				runs.push({ content: node.textContent, marks: orderedMarks(node.marks), isText: false });
				break;
			case 'typ_ref':
				runs.push({ content: `@${String(node.attrs.target ?? '')}`, marks: orderedMarks(node.marks), isText: false });
				break;
			case 'inline_math':
				runs.push({ content: `$${mathTypstOf(node)}$`, marks: orderedMarks(node.marks), isText: false });
				break;
			default:
				runs.push({ content: node.isLeaf ? '' : renderInline(node, false), marks: orderedMarks(node.marks), isText: false });
		}
		atLineStart = false;
	});
	return runs.filter((r) => r.content !== '');
}

function commonPrefixLen(a: Mark[], b: Mark[]): number {
	let n = 0;
	while (n < a.length && n < b.length && a[n].eq(b[n])) n++;
	return n;
}

/** minimal open/close mark transitions over same-mark runs, expelling boundary whitespace out
 *  of emphasis delimiters (`* bold*` never parses back as strong). */
export function renderInline(parent: Node, startOfLine = true): string {
	const runs = buildRuns(parent, startOfLine);
	let out = '';
	let active: Mark[] = [];

	function emitCloses(closing: Mark[]) {
		let stolen = '';
		if (closing.some((m) => MARK_DELIMS[m.type.name]?.(m.attrs).expel)) {
			const ws = out.match(/(\s+)$/);
			if (ws && ws[1].length < out.length) {
				out = out.slice(0, -ws[1].length);
				stolen = ws[1];
			}
		}
		for (const m of closing) {
			const d = MARK_DELIMS[m.type.name];
			if (d) out += d(m.attrs).close;
		}
		out += stolen;
	}

	for (const run of runs) {
		const keep = commonPrefixLen(active, run.marks);
		emitCloses(active.slice(keep).reverse());
		const opening = run.marks.slice(keep);
		let content = run.content;
		if (run.isText && opening.some((m) => MARK_DELIMS[m.type.name]?.(m.attrs).expel)) {
			const lead = content.match(/^\s+/);
			if (lead && lead[0].length < content.length) {
				out += lead[0];
				content = content.slice(lead[0].length);
			}
		}
		for (const m of opening) {
			const d = MARK_DELIMS[m.type.name];
			if (d) out += d(m.attrs).open;
		}
		out += content;
		active = run.marks;
	}
	emitCloses([...active].reverse());
	return out;
}
