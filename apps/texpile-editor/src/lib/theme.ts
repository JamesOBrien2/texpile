// light/dark/system appearance. the resolved mode lands as data-mode + a .dark class on <html>;
// an inline script in app.html mirrors the resolve logic pre-paint to avoid a flash (reading the
// texpile:layout blob directly - keep its `theme` field in step with this module).
import { box } from '$lib/runes/box.svelte';
import { layout, updateLayout } from '$lib/storage/layout';

export type ThemeChoice = 'light' | 'dark' | 'system';

function stored(): ThemeChoice {
	return layout.current.theme;
}

function systemPrefersDark(): boolean {
	return (
		typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
	);
}

function resolve(choice: ThemeChoice): 'light' | 'dark' {
	return choice === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : choice;
}

/** the mode actually rendered (light/dark) after resolving "system". */
export const resolvedMode = box<'light' | 'dark'>('light');

function apply(resolved: 'light' | 'dark'): void {
	resolvedMode.current = resolved;
	if (typeof document === 'undefined') return;
	document.documentElement.setAttribute('data-mode', resolved);
	document.documentElement.classList.toggle('dark', resolved === 'dark');
}

/** the user's choice (light/dark/system), what the Preferences control binds to. */
export const themeChoice = box<ThemeChoice>(stored());

let mql: MediaQueryList | null = null;
function watchSystem(choice: ThemeChoice): void {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
	mql ??= window.matchMedia('(prefers-color-scheme: dark)');
	mql.onchange = choice === 'system' ? () => apply(resolve('system')) : null;
}

export function setTheme(choice: ThemeChoice): void {
	themeChoice.current = choice;
	updateLayout({ theme: choice });
	apply(resolve(choice));
	watchSystem(choice);
}

// apply on module load; app.html's inline script already handled the very first paint
if (typeof document !== 'undefined') {
	const choice = stored();
	apply(resolve(choice));
	watchSystem(choice);
}
