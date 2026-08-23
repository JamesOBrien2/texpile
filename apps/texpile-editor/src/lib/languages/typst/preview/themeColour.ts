// Shared by the local preview pane and the guest's remote one, which theme the same page.

/**
 * The app's own colour for `name`, resolved to a concrete rgb() - NOT the raw declaration.
 *
 * The raw value is oklch(...) in this theme, and the colour crosses an IPC boundary whose
 * sanitizer (cssColour in electron main) passes only a colour-shaped charset. A probe element's
 * computed style normalises any colour syntax to rgb(), which survives every hop.
 */
export function themeColour(name: string, fallback: string): string {
	if (typeof document === 'undefined') return fallback;
	if (!getComputedStyle(document.documentElement).getPropertyValue(name).trim()) return fallback;
	const probe = document.createElement('div');
	probe.style.color = `var(${name})`;
	document.documentElement.appendChild(probe);
	const v = getComputedStyle(probe).color;
	probe.remove();
	return v || fallback;
}
