// Contract tests over REAL engine output for a spread of scripts and font loaders.
// See tests/fixtures/lang/README.md; regenerate with scripts/capture-lang-fixtures.mjs.
//
// Hand-written records could not have caught the bug these exist for -- it was in what
// luaotfload reports about a font, not in anything we would have thought to write down.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as opentype from 'opentype.js';
import { parseRecords, pageIsRtl } from '$lib/draft/pageRecords';
import { buildDrawList } from '$lib/draft/renderCore';
import { sfntFromTtc } from '$lib/draft/ttc';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/lang');

/* eslint-disable @typescript-eslint/no-explicit-any */
type Case = { name: string; records: any[]; dropped: number; page: any; fonts: any[] };

const CASES: Case[] = fs
	.readdirSync(dir)
	.filter((f) => f.endsWith('.jsonl'))
	.map((f) => {
		const name = f.replace(/\.jsonl$/, '');
		const { records, dropped } = parseRecords(fs.readFileSync(path.join(dir, f), 'utf8'));
		const page = JSON.parse(fs.readFileSync(path.join(dir, `${name}.pages.json`), 'utf8')).pages[0];
		return { name, records, dropped, page, fonts: records.filter((r) => r.t === 'font') };
	});

// which cases SHOULD be right-to-left, stated here rather than read back off the fixture, so a
// capture that quietly stopped flagging them fails instead of agreeing with itself
const RTL = new Set(['hebrew-rtl', 'arabic-rtl']);

it('the fixture set was captured', () => {
	expect(CASES.map((c) => c.name).sort()).toEqual(['arabic-rtl', 'cjk-ttc', 'cm-baseline', 'fontspec-space', 'greek', 'hebrew-rtl']);
});

describe.each(CASES)('$name', ({ name, records, dropped, page, fonts }) => {
	it('every record parses', () => {
		expect(dropped).toBe(0);
		expect(records.length).toBeGreaterThan(0);
	});

	it('declares a font for every glyph it draws', () => {
		const ids = new Set(fonts.map((f) => f.id));
		for (const g of records.filter((r) => r.t === 'g')) expect(ids).toContain(g.f);
	});

	it('reports font paths the renderer can actually fetch', () => {
		expect(fonts.length).toBeGreaterThan(0);
		for (const f of fonts) {
			// "harfloaded:" is luaotfload's loader tag, not part of the path. Passing it through
			// made every fetch 404, so a Hebrew page loaded no font and drew nothing at all.
			expect(f.file).not.toMatch(/^harfloaded:/);
			expect(f.file).toMatch(/\.(otf|ttf|ttc|otc)$/i);
			// a collection has to say WHICH face, or the wrong one gets parsed
			if (/\.(ttc|otc)$/i.test(f.file)) expect(f.sub).toBeGreaterThanOrEqual(1);
		}
	});

	it('carries a glyph index for every HarfBuzz-shaped glyph', () => {
		// harf substitutes glyphs, so a shaped run's char values stop standing for the codepoints
		// that produced them (Arabic comes back as presentation forms). Only the index resolves.
		const harf = new Set(fonts.filter((f) => /mode=harf/.test(f.name)).map((f) => f.id));
		if (!harf.size) return expect(records.some((r) => r.t === 'g')).toBe(true);
		for (const g of records.filter((r) => r.t === 'g' && harf.has(r.f))) expect(g.gi).toBeGreaterThan(0);
	});

	it('flags right-to-left pages and only those', () => {
		expect(pageIsRtl(page.unc)).toBe(RTL.has(name));
	});
});

// The end-to-end check: parse the fonts the engine named and confirm every glyph resolves to
// real outlines. Font paths are absolute and machine-specific, so this runs only where the
// capture was made -- elsewhere the shape assertions above still hold.
describe.each(CASES)('$name outlines', ({ fonts, records }) => {
	const present = fonts.every((f) => fs.existsSync(f.file));
	it.skipIf(!present)('draws every glyph, none falling back to .notdef', () => {
		const parsed = new Map<number, any>();
		for (const f of fonts) {
			const buf = fs.readFileSync(f.file);
			const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
			parsed.set(f.id, { ot: opentype.parse(sfntFromTtc(ab, (f.sub || 1) - 1)), size: f.size });
		}
		const { stats } = buildDrawList(records, (id) => parsed.get(id) ?? null, 1);
		expect(stats.glyphsDrawn).toBe(records.filter((r) => r.t === 'g').length);
		expect(stats.notdef).toBe(0);
	});
});
