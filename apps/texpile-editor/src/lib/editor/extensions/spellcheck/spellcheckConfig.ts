// seeds editorConfigStore (spell-check toggle + custom dictionary) and mirrors changes back so
// they persist. The two halves live in different stores on purpose: the TOGGLE is app
// configuration (settings.json), the WORD LIST is the user's own data (texpile:users).
import { get } from 'svelte/store';
import { editorConfigStore } from '$lib/stores/editorStore';
import type { EditorConfiguration } from '$lib/types/editorcfg';
import { loadSettings, updateSettings, settings } from '$lib/settings';
import { users, updateUsers } from '$lib/storage/users';

// collaboration/transpileTemplate are required by the type but unused here
const DEFAULT_CONFIG: EditorConfiguration = {
	dictionary: [],
	spellcheck: false,
	transpileTemplate: '',
	collaboration: { anyone: 'none', editors: [] }
};

let initialized = false;

/** seeds editorConfigStore and persists toggle/dictionary changes back. idempotent. */
export async function initSpellcheckConfig(): Promise<void> {
	if (initialized) return;
	initialized = true;

	const s = await loadSettings();
	editorConfigStore.set({ ...DEFAULT_CONFIG, spellcheck: s.spellcheck, dictionary: get(users).dictionary });

	editorConfigStore.subscribe((c) => {
		if (!c) return;
		if (c.spellcheck !== get(settings).spellcheck) updateSettings({ spellcheck: c.spellcheck });
		if (c.dictionary !== get(users).dictionary) updateUsers({ dictionary: c.dictionary });
	});
}

export function setSpellcheckEnabled(enabled: boolean): void {
	editorConfigStore.update((c) => ({ ...(c ?? DEFAULT_CONFIG), spellcheck: enabled }));
}
