// \includegraphics without an extension must resolve like the engine would (probe, .pdf first),
// and PDF sources must be flagged so the node view renders them instead of handing a PDF to <img>
import { describe, it, expect } from 'vitest';
import { resolveGraphicUrl, GRAPHIC_PROBE_EXTENSIONS } from '$lib/editor/visual/extensions/image/graphicSrcResolve';

const urlFor = (rel: string) => `served:/${rel}`;
const existing = (files: string[]) => async (url: string) => files.includes(url);

describe('resolveGraphicUrl', () => {
	it('an explicit extension is trusted without probing', async () => {
		let probes = 0;
		const r = await resolveGraphicUrl('figs/plot.png', urlFor, async () => (probes++, true));
		expect(r).toEqual({ url: 'served:/figs/plot.png', isPdf: false });
		expect(probes).toBe(0);
	});

	it('flags an explicit .pdf regardless of case', async () => {
		expect((await resolveGraphicUrl('BERT_Overall.pdf', urlFor, async () => true)).isPdf).toBe(true);
		expect((await resolveGraphicUrl('BERT_Overall.PDF', urlFor, async () => true)).isPdf).toBe(true);
	});

	it('probes an extensionless src and prefers .pdf, as pdflatex does', async () => {
		const r = await resolveGraphicUrl('BERT_Overall', urlFor, existing(['served:/BERT_Overall.pdf', 'served:/BERT_Overall.png']));
		expect(r).toEqual({ url: 'served:/BERT_Overall.pdf', isPdf: true });
	});

	it('falls through to whichever raster exists', async () => {
		const r = await resolveGraphicUrl('fig1', urlFor, existing(['served:/fig1.jpg']));
		expect(r).toEqual({ url: 'served:/fig1.jpg', isPdf: false });
	});

	it('nothing found: bare join so the <img> error path shows not-found', async () => {
		const probed: string[] = [];
		const r = await resolveGraphicUrl('ghost', urlFor, async (u) => (probed.push(u), false));
		expect(r).toEqual({ url: 'served:/ghost', isPdf: false });
		expect(probed).toHaveLength(GRAPHIC_PROBE_EXTENSIONS.length);
	});
});
