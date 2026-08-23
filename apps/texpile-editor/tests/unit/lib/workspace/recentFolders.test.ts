// @vitest-environment jsdom
//
// The recents MRU lives in the texpile:users blob now. The store hydrates at MODULE INIT, so each
// case re-imports with localStorage already seeded - the only way to catch init-order bugs (the
// original motivation: a TDZ read at init once made the list come back empty every launch, and the
// first folder opened then overwrote the whole history).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const KEY = 'texpile:users';
const seed = (recentFolders: unknown) => localStorage.setItem(KEY, JSON.stringify({ v: 1, recentFolders }));
const stored = () => JSON.parse(localStorage.getItem(KEY)!).recentFolders;
const load = () => import('$lib/storage/users');

describe('recentFolders', () => {
	beforeEach(() => {
		localStorage.clear();
		vi.resetModules();
	});

	it('hydrates from the users blob at module init', async () => {
		seed(['/a', '/b', '/c']);
		const { users } = await load();
		expect(get(users).recentFolders).toEqual(['/a', '/b', '/c']);
	});

	it('prepends a newly opened folder without losing the history', async () => {
		seed(['/a', '/b']);
		const { users, addRecentFolder } = await load();
		addRecentFolder('/c');
		expect(get(users).recentFolders).toEqual(['/c', '/a', '/b']);
		expect(stored()).toEqual(['/c', '/a', '/b']);
	});

	it('moves a folder already in the list to the front rather than duplicating it', async () => {
		seed(['/a', '/b', '/c']);
		const { users, addRecentFolder } = await load();
		addRecentFolder('/c');
		expect(get(users).recentFolders).toEqual(['/c', '/a', '/b']);
	});

	it('caps the list on read as well as write', async () => {
		seed(Array.from({ length: 20 }, (_, i) => `/f${i}`));
		const { users, addRecentFolder } = await load();
		expect(get(users).recentFolders).toHaveLength(10);
		addRecentFolder('/new');
		expect(get(users).recentFolders).toHaveLength(10);
		expect(get(users).recentFolders[0]).toBe('/new');
	});

	it('survives junk in storage rather than throwing at import', async () => {
		localStorage.setItem(KEY, '{not json');
		const { users } = await load();
		expect(get(users).recentFolders).toEqual([]);
	});

	it('drops non-string entries', async () => {
		seed(['/a', 42, null, '/b']);
		const { users } = await load();
		expect(get(users).recentFolders).toEqual(['/a', '/b']);
	});
});
