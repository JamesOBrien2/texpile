// Open flags for dialogs that more than one place needs to raise.
//
// Preferences used to be local state inside WorkspaceMenuBar, which is fine while the File menu is
// the only way in. The command palette is a second way in, and it has no path to a child
// component's state - so the flag moves out here, the same shape as updateModalOpen and
// whatsNewOpen. Not persisted; this is transient UI state, not a setting.
import { writable } from 'svelte/store';

export const preferencesOpen = writable(false);
