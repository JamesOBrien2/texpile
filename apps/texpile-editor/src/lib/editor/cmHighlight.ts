// The one highlight style every CodeMirror in the app shares - source editor, raw islands, code
// blocks, diff panel - so LaTeX, Markdown and Typst colour the same construct the same way.
// CodeMirror's defaultHighlightStyle is the base; dark mode gets a brightened same-hue variant,
// swapped via a Compartment when the resolved mode changes.
import { Compartment, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { get } from 'svelte/store';
import { resolvedMode } from '$lib/theme';

function parseHex(c: string): { r: number; g: number; b: number } | null {
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
	if (!m) return null;
	let h = m[1];
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	let h = 0;
	let s = 0;
	if (d !== 0) {
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
	}
	return { h, s, l };
}

/** lighten a token color so it reads on the dark surface, keeping its hue. */
function brighten(color: string): string {
	const rgb = parseHex(color);
	if (!rgb) return color; // non-hex (named/hsl), leave as-is
	const { h, s } = rgbToHsl(rgb.r, rgb.g, rgb.b);
	const sat = Math.min(Math.max(s, 0.4), 0.85);
	return `hsl(${Math.round(h)} ${Math.round(sat * 100)}% 72%)`;
}

// defaultHighlightStyle plus the tags our dialects lean on that it leaves unstyled: LaTeX
// commands and Typst function calls (function-of-variableName), inline code / verbatim / raw
// blocks (monospace), and list markers (\item, -, +). Colours stay in the default palette's
// families so the additions read as part of the same theme.
const unifiedSpecs = [
	...defaultHighlightStyle.specs,
	{ tag: tags.function(tags.variableName), color: '#00c' },
	{ tag: tags.monospace, color: '#164' },
	{ tag: tags.list, color: '#219' }
];

const lightHighlightStyle = HighlightStyle.define(unifiedSpecs);
const darkHighlightStyle = HighlightStyle.define(
	unifiedSpecs.map((spec) => {
		const color = (spec as { color?: string }).color;
		return color ? { ...spec, color: brighten(color) } : spec;
	})
);

const compartment = new Compartment();
const styleFor = (mode: 'light' | 'dark'): Extension => syntaxHighlighting(mode === 'dark' ? darkHighlightStyle : lightHighlightStyle);

// editors that opt in register here; a mode change reconfigures all of them
const views = new Set<EditorView>();
const tracker = ViewPlugin.define((view) => {
	views.add(view);
	return { destroy: () => views.delete(view) };
});
resolvedMode.subscribe((mode) => {
	for (const v of views) v.dispatch({ effects: compartment.reconfigure(styleFor(mode)) });
});

/** syntax highlighting that follows the app's light/dark mode; use instead of syntaxHighlighting(defaultHighlightStyle). */
export function cmSyntaxHighlight(): Extension {
	return [compartment.of(styleFor(get(resolvedMode))), tracker];
}
