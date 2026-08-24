// FIRST import, load-bearing: migrates pre-restructure storage keys before any module below
// reads one at module scope (the theme, the layout store, the recents list)
import '$lib/migration/local';
import { mount } from 'svelte';
import './app.css';
import '$lib/theme'; // side-effect: applies the saved appearance and watches OS changes
import { loadSettings } from '$lib/settings';
import { adoptBootOpen, bootOpen } from '$lib/workspace/openWorkspace';
import { focusDoctor } from '$lib/debug/focusDoctor';
import App from './App.svelte';

// Silence console.log is from legacy webapp, not nesscarily needed for desktop app
window.texpile = window.texpile || { debug: { log: import.meta.env.DEV } };
window.texpileFocusDoctor = focusDoctor;
const originalLog = console.log;
console.log = (...args: unknown[]) => {
	if (window.texpile?.debug?.log) {
		originalLog.apply(console, args);
	}
};

// some pre-bundler libraries probe a Node-style `global`
(window as unknown as { global: Window }).global = window;

window.addEventListener('error', (e) => console.error('[client error]', (e.error && e.error.stack) || e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[client error]', e.reason));

// A restored window knows its folder before it renders anything, so it adopts it here rather than
// mounting the start screen and swapping: the route is already /workspace at first render, and the
// editor chunk streams alongside the folder scan instead of after it.
const boot = bootOpen();
if (boot) {
	// App's own loader owns the retry and the error path; this is only the head start
	void import('./views/workspace/WorkspaceView.svelte').catch(() => {});
	adoptBootOpen(boot);
}

// wait for the persisted uiLocale before the first render, so a non-English user never sees a
// flash of English UI (settings.ts applies the locale as soon as this resolves). top-level await
// isn't available at this app's build target, hence the .then() instead of an await here.
loadSettings().then(() => {
	mount(App, { target: document.getElementById('app')! });
});
