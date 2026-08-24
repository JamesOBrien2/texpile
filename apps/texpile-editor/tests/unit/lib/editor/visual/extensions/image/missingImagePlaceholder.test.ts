// the card embeds the missing path as SVG text: unescaped markup characters would corrupt the
// image (a path is user data), and an over-long path must keep its tail, where the filename is
import { describe, it, expect } from 'vitest';
import { missingImageSvg } from '$lib/editor/visual/extensions/image/missingImagePlaceholder';

function svgOf(path: string): string {
	const uri = missingImageSvg(path);
	expect(uri.startsWith('data:image/svg+xml;utf8,')).toBe(true);
	return decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length));
}

describe('missingImageSvg', () => {
	it('names the missing file in the card', () => {
		expect(svgOf('figs/BERT_Overall.pdf')).toContain('figs/BERT_Overall.pdf');
	});

	it('escapes markup characters in the path', () => {
		const svg = svgOf('a&b<c>.png');
		expect(svg).toContain('a&amp;b&lt;c&gt;.png');
		expect(svg).not.toContain('<c>');
	});

	it('middle-truncates an over-long path, keeping the filename tail', () => {
		const svg = svgOf('very/long/nested/path/that/never/seems/to/end/figure-final-v2.pdf');
		expect(svg).toContain('…');
		expect(svg).toContain('figure-final-v2.pdf');
	});
});
