import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Node as PMNode } from 'prosemirror-model';
import { parseMarkdownFile } from '$lib/languages/markdown/visual/roundtrip';
import { parseLatexFile } from '$lib/workspace/latexRoundtrip';
import { parseTypstFile } from '$lib/languages/typst/visual/roundtrip';
import { buildPmAnchor } from '$lib/editor/extensions/pmComments';
import { toSourceAnchor, type AnchorDialect } from '$lib/comments/anchor';

// The bug this reproduces: drag a random selection in a visual editor, hit Comment, and the
// thread lands detached because the rendered quote cannot be carried back onto the marked-up
// source. Every sampled selection with enough real text must convert to a SOURCE anchor -
// precisely, or downgraded to its block(s) - never detached.

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../fixtures/comments/${name}`, import.meta.url)), 'utf8');

/** deterministic PRNG (mulberry32) so a failure reproduces byte-for-byte */
function rng(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const SAMPLES = 400;

function fuzz(src: string, doc: PMNode, dialect: AnchorDialect, seed: number): string[] {
	const size = doc.content.size;
	const rand = rng(seed);
	const failures: string[] = [];
	for (let k = 0; k < SAMPLES; k++) {
		const from = 1 + Math.floor(rand() * (size - 2));
		const to = Math.min(size - 1, from + 3 + Math.floor(rand() * 180));
		if (to <= from) continue;
		const anchor = buildPmAnchor(doc, from, to);
		if (!anchor) continue;
		// a selection that is mostly atoms/whitespace has nothing to search for; those may
		// honestly detach (the pill still offers them, but there is no text to pin)
		const real = anchor.quote.replace(/[￼\s]+/g, '');
		if (real.length < 4) continue;
		const { tier } = toSourceAnchor(src, dialect, anchor);
		if (tier === 'detached') failures.push(`[${from},${to}] ${JSON.stringify(anchor.quote.slice(0, 90))}`);
	}
	return failures;
}

describe('random visual selections anchor into source', () => {
	it('markdown: feature-sweep.md', () => {
		const src = fixture('feature-sweep.md');
		expect(fuzz(src, parseMarkdownFile(src).doc, 'md', 0xc0ffee)).toEqual([]);
	});

	it('markdown: guide.md', () => {
		const src = fixture('guide.md');
		expect(fuzz(src, parseMarkdownFile(src).doc, 'md', 0xbadf00d)).toEqual([]);
	});

	it('latex: feature-sweep.tex', () => {
		const src = fixture('feature-sweep.tex');
		expect(fuzz(src, parseLatexFile(src).doc, 'tex', 0xdecade)).toEqual([]);
	});

	it('typst: feature-sweep.typ', () => {
		const src = fixture('feature-sweep.typ');
		expect(fuzz(src, parseTypstFile(src).doc, 'typ', 0xfab1e5)).toEqual([]);
	});
});
