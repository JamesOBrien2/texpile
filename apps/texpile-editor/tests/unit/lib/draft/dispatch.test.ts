import { describe, expect, it } from 'vitest';
import { decideEdit, daemonReady, repairForPreview } from '$lib/draft/dispatch';

// The compound-alignment rules: an exact patch never advances the baseline, so "type in a
// paragraph, then open a new one" must read as ONE merged engine typeset (prev + \par +
// new), never a JS-placed splice -- indent and spacing are the engine's to decide.
const DOC = [
	'\\documentclass{article}',
	'\\begin{document}',
	'Alpha one two three.',
	'',
	'Beta four five six.',
	'\\end{document}',
	''
].join('\n');

describe('decideEdit compound alignment', () => {
	it('rides a clean-baseline insert on the previous block (engine-true spacing)', () => {
		const src = DOC.replace('Beta four', 'Fresh inserted paragraph.\n\nBeta four');
		const d = decideEdit(DOC, src);
		expect(d.kind).toBe('patch');
		if (d.kind !== 'patch') return;
		expect(d.orig).toBe('Alpha one two three.');
		expect(d.text).toBe('Alpha one two three.\n\\par Fresh inserted paragraph.');
	});

	it('rides an env-anchored insert on the whole environment (engine supplies the indent)', () => {
		const doc = DOC.replace('Alpha one two three.', 'Alpha one two three.\n\n\\begin{quote}\nquoted words\n\\end{quote}');
		const src = doc.replace('\nBeta four', '\n\\noindent Fresh flush paragraph.\n\nBeta four');
		const d = decideEdit(doc, src);
		expect(d.kind).toBe('patch');
		if (d.kind !== 'patch') return;
		expect(d.orig).toBe('\\begin{quote}\nquoted words\n\\end{quote}');
		// the typed \noindent ships verbatim; the ENGINE executes it after the real \par
		expect(d.text).toBe('\\begin{quote}\nquoted words\n\\end{quote}\n\\par \\noindent Fresh flush paragraph.');
	});

	it('rides a heading insert on the previous block (typing from scratch is headings + prose)', () => {
		const src = DOC.replace('Beta four', '\\section{Fresh}\n\nBeta four');
		const d = decideEdit(DOC, src);
		expect(d.kind).toBe('patch');
		if (d.kind !== 'patch') return;
		expect(d.orig).toBe('Alpha one two three.');
		// the heading ships verbatim inside the merged unit; its number is the engine's
		// (deterministic via the daemon counter reset) and certifies via the reconcile
		expect(d.text).toBe('Alpha one two three.\n\\par \\section{Fresh}');
	});

	it('still sends a float insert to the full pass', () => {
		const src = DOC.replace('Beta four', '\\begin{table}\nx\n\\end{table}\n\nBeta four');
		const d = decideEdit(DOC, src);
		expect(d.kind).toBe('structural');
	});

	it('merges a pending edit + adjacent new paragraph into ONE patch (no alternation)', () => {
		const src = DOC.replace('Alpha one two three.', 'Alpha one x two three.\n\nFresh inserted paragraph.');
		const d = decideEdit(DOC, src);
		expect(d.kind).toBe('patch');
		if (d.kind !== 'patch') return;
		expect(d.orig).toBe('Alpha one two three.');
		expect(d.text).toBe('Alpha one x two three.\n\\par Fresh inserted paragraph.');
	});

	it('rides a pure delete on the previous block (engine computes the closed-up height)', () => {
		const src = DOC.replace('\n\nBeta four five six.', '');
		const d = decideEdit(DOC, src);
		expect(d.kind).toBe('patch');
		if (d.kind !== 'patch') return;
		expect(d.orig).toBe('Alpha one two three.\n\\par Beta four five six.');
		expect(d.text).toBe('Alpha one two three.');
	});

	it('sends delete-compounds and wide edits to the full pass', () => {
		// delete + pending edit: the two-splice form alternated visually; full pass is honest
		const del = decideEdit(DOC, DOC.replace('Alpha one two three.', 'Alpha one x two three.').replace('\nBeta four five six.', ''));
		expect(del.kind).toBe('structural');
		// two edited paragraphs + an insert is beyond any compound: plain structural
		const wide = decideEdit(DOC, DOC.replace('Alpha one two three.', 'Alpha X.\n\nNew para.').replace('Beta four five six.', 'Beta Y.'));
		expect(wide.kind).toBe('structural');
	});

	it('ships the float alignment with a confined tabular (daemon records carry the centering)', () => {
		const float = [
			'\\begin{table}[h]',
			'\\centering',
			'\\begin{tabular}{ll}',
			'a & b \\\\',
			'\\end{tabular}',
			'\\caption{Cap.}',
			'\\end{table}'
		].join('\n');
		const doc = DOC.replace('Beta four five six.', float);
		const d = decideEdit(doc, doc.replace('a & b', 'a & bx'));
		expect(d.kind).toBe('patch');
		if (d.kind !== 'patch') return;
		expect(d.floatInner).toBe(true);
		expect(d.orig).toBe('\\centering\\begin{tabular}{ll}\na & b \\\\\n\\end{tabular}');
		expect(d.text).toBe('\\centering\\begin{tabular}{ll}\na & bx \\\\\n\\end{tabular}');
	});

	it('flags a command entering the paragraph so the patch certifies via reconcile', () => {
		const cmd = decideEdit(DOC, DOC.replace('Alpha one', 'Alpha \\noindent one'));
		expect(cmd.kind).toBe('patch');
		if (cmd.kind === 'patch') expect(cmd.cmdChanged).toBe(true);
		// pure prose typing (and our own \par joiner) keeps the exact tier
		const prose = decideEdit(DOC, DOC.replace('Alpha one', 'Alpha xone'));
		expect(prose.kind).toBe('patch');
		if (prose.kind === 'patch') expect(prose.cmdChanged).toBe(false);
		const merged = decideEdit(DOC, DOC.replace('Beta four', 'Fresh inserted paragraph.\n\nBeta four'));
		expect(merged.kind).toBe('patch');
		if (merged.kind === 'patch') expect(merged.cmdChanged).toBe(false);
	});
});

describe('mid-typing math balance', () => {
	it('treats unclosed \\( and \\[ as not ready, like an odd $', () => {
		expect(daemonReady('open \\(x + y')).toBe(false);
		expect(daemonReady('open \\[x + y')).toBe(false);
		expect(daemonReady('closed \\(x + y\\) fine')).toBe(true);
		expect(daemonReady('a stray closer \\) alone')).toBe(false);
		// \\[2pt] is a line break argument, not display math
		expect(daemonReady('broken line \\\\[2pt] more')).toBe(true);
	});

	it('repairs \\( in nesting order with $ and braces', () => {
		expect(repairForPreview('\\(x + \\textbf{y')).toBe('\\(x + \\textbf{y\n}\\)');
		expect(repairForPreview('mismatch \\(x }')).toBeNull();
	});

	it('rides a mid-math NEW paragraph on the merged run as a transient', () => {
		const src = DOC.replace('Beta four', 'The identity $e^{i\\pi\n\nBeta four');
		const d = decideEdit(DOC, src);
		expect(d.kind).toBe('patch');
		if (d.kind !== 'patch') return;
		expect(d.transient).toBe(true);
		// buildPatch repaired the merged text: closers in nesting order on their own line
		expect(d.text).toBe('Alpha one two three.\n\\par The identity $e^{i\\pi\n}$');
	});

	it('rides a mid-heading state on the merged run as a transient', () => {
		const src = DOC.replace('Beta four', '\\section{Openin\n\nBeta four');
		const d = decideEdit(DOC, src);
		expect(d.kind).toBe('patch');
		if (d.kind !== 'patch') return;
		expect(d.transient).toBe(true);
	});
});
