// Blocks separated by a SINGLE newline must keep that separator across a no-edit save.
//
// Found by running our round trip over typst's own test suite (text/raw.typ). A code fence carried
// no `orig` attr at all: ORIG_BLOCKS in schema.ts adds one to code_block's spec, and both dialect
// schemas then replaced that spec's attrs wholesale, dropping it. Without `orig` a fence can never
// be recognised as pristine, so it always regenerated - and regeneration forces exactly one blank
// line between blocks. `#set page(..)` written directly above a fence came back with a blank line
// inserted, on every single save, in a file the user had not touched.
//
// Both dialects are covered because both schemas had the same line, and the machinery underneath
// (blockAssembly) is shared with LaTeX.
import { describe, it, expect } from 'vitest';
import { parseTypstFile, serializeTypstFile } from '$lib/typst/visual/roundtrip';
import { parseMarkdownFile, serializeMarkdownFile } from '$lib/markdown/roundtrip';

const FENCE = '```';

const TYPST: Record<string, string> = {
	'set rule then fence': `#set page(width: auto)\n${FENCE}typ\nx\n${FENCE}\n`,
	'fence then set rule': `${FENCE}typ\nx\n${FENCE}\n#set page(width: auto)\n`,
	'paragraph then fence': `Text.\n${FENCE}typ\nx\n${FENCE}\n`,
	'fence then paragraph': `${FENCE}typ\nx\n${FENCE}\nText.\n`,
	'a real blank line stays exactly one': `#set page(width: auto)\n\n${FENCE}typ\nx\n${FENCE}\n`,
	'two fences back to back': `${FENCE}typ\na\n${FENCE}\n${FENCE}typ\nb\n${FENCE}\n`
};

const MARKDOWN: Record<string, string> = {
	'paragraph then fence': `Text.\n${FENCE}js\nx\n${FENCE}\n`,
	'fence then paragraph': `${FENCE}js\nx\n${FENCE}\nText.\n`,
	'a real blank line stays exactly one': `Text.\n\n${FENCE}js\nx\n${FENCE}\n`
};

describe('typst: a single newline between blocks survives a no-edit save', () => {
	for (const [name, src] of Object.entries(TYPST)) {
		it(name, () => {
			const parsed = parseTypstFile(src);
			expect(serializeTypstFile(parsed, parsed.doc)).toBe(src);
		});
	}
});

describe('markdown: the same schema line had the same effect', () => {
	for (const [name, src] of Object.entries(MARKDOWN)) {
		it(name, () => {
			const parsed = parseMarkdownFile(src);
			expect(serializeMarkdownFile(parsed, parsed.doc)).toBe(src);
		});
	}
});

describe('no dialect schema drops the orig attr', () => {
	// The defect asserted at its own level rather than at the one symptom that exposed it. A
	// dialect schema that respecifies a node's attrs must spread the base ones, or that node
	// silently loses verbatim re-emission - which shows up not as an error but as whitespace
	// quietly changing in files nobody edited. code_block is how this was found; the loop is what
	// stops the next override from doing it somewhere else.
	//
	// Kept in step with ORIG_BLOCKS in schema.ts by construction: a name added there but missing
	// from a schema is reported as absent, not silently skipped.
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
		'table',
		'list'
	];

	it.each([
		['latex', () => import('$lib/schema/latexPMSchema/latexPMSchema').then((m) => m.schema)],
		['markdown', () => import('$lib/markdown/schema').then((m) => m.mdSchema)],
		['typst', () => import('$lib/typst/visual/schema').then((m) => m.typSchema)]
	])('%s', async (_name, get) => {
		const schema = await get();
		// only nodes the dialect actually has: markdown has no \abstract, typst no environments
		const present = ORIG_BLOCKS.filter((n) => schema.nodes[n]);
		expect(present.filter((n) => !('orig' in (schema.nodes[n].spec.attrs ?? {})))).toEqual([]);
	});
});
