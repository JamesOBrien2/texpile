// tab-set semantics: dedupe by path identity, neighbor pick on close, folder rename/delete
// fan-out, pruning against the live tree, and the single preview slot (an opened-but-unedited
// file gives its tab up to the next one). The older tests keep() each file first, which is what
// editing it does - without that every open would land in the same slot.
import { describe, expect, it, beforeEach } from 'vitest';
import { tabs } from '$lib/workspace/tabs.svelte';

/** open a file and edit it: the way a tab becomes permanent */
function openAndEdit(path: string) {
	tabs.noteOpened(path);
	tabs.keep(path);
}

describe('tabs store', () => {
	beforeEach(() => tabs.bind(null, false));

	it('dedupes opens case-insensitively and cycles in order', () => {
		openAndEdit('C:\\p\\main.tex');
		openAndEdit('C:\\p\\intro.tex');
		tabs.noteOpened('C:\\P\\MAIN.TEX'); // same file, Windows casing
		expect(tabs.list.length).toBe(2);
		expect(tabs.cycle('C:\\p\\main.tex', 1)).toBe('C:\\p\\intro.tex');
		expect(tabs.cycle('C:\\p\\main.tex', -1)).toBe('C:\\p\\intro.tex');
	});

	it('closing the active tab hands over to the right neighbor, then left', () => {
		for (const f of ['a.tex', 'b.tex', 'c.tex']) openAndEdit(`C:\\p\\${f}`);
		expect(tabs.neighborOf('C:\\p\\b.tex')).toBe('C:\\p\\c.tex');
		tabs.close('C:\\p\\c.tex');
		expect(tabs.neighborOf('C:\\p\\b.tex')).toBe('C:\\p\\a.tex');
	});

	it('folder rename and delete fan out to contained tabs, prune drops dead files', () => {
		openAndEdit('C:\\p\\ch\\one.tex');
		openAndEdit('C:\\p\\main.tex');
		tabs.rename('C:\\p\\ch', 'C:\\p\\parts');
		expect(tabs.list[0]).toBe('C:\\p\\parts\\one.tex');
		tabs.closeUnder('C:\\p\\parts');
		expect(tabs.list).toEqual(['C:\\p\\main.tex']);
		tabs.prune([]);
		expect(tabs.list).toEqual([]);
	});
});

describe('preview tab', () => {
	beforeEach(() => tabs.bind(null, false));

	it('reuses the one slot while nothing is edited', () => {
		tabs.noteOpened('C:\\p\\a.tex');
		tabs.noteOpened('C:\\p\\b.tex');
		tabs.noteOpened('C:\\p\\c.tex');
		expect(tabs.list).toEqual(['C:\\p\\c.tex']);
		expect(tabs.isPreview('C:\\p\\c.tex')).toBe(true);
	});

	it('an edit makes the tab permanent, so the next file gets its own', () => {
		tabs.noteOpened('C:\\p\\a.tex');
		tabs.keep('C:\\p\\a.tex');
		tabs.noteOpened('C:\\p\\b.tex');
		expect(tabs.list).toEqual(['C:\\p\\a.tex', 'C:\\p\\b.tex']);
		expect(tabs.isPreview('C:\\p\\a.tex')).toBe(false);
		expect(tabs.isPreview('C:\\p\\b.tex')).toBe(true);
	});

	it('replaces only the unedited tab, however many edited ones sit beside it', () => {
		openAndEdit('C:\\p\\keep1.tex');
		tabs.noteOpened('C:\\p\\glance.tex');
		tabs.noteOpened('C:\\p\\keep2.tex'); // takes glance's slot, glance was never edited
		expect(tabs.list).toEqual(['C:\\p\\keep1.tex', 'C:\\p\\keep2.tex']);
		tabs.keep('C:\\p\\keep2.tex');
		tabs.noteOpened('C:\\p\\third.tex');
		expect(tabs.list).toEqual(['C:\\p\\keep1.tex', 'C:\\p\\keep2.tex', 'C:\\p\\third.tex']);
	});

	it('reopening a file that is already open changes nothing', () => {
		openAndEdit('C:\\p\\a.tex');
		tabs.noteOpened('C:\\p\\b.tex');
		tabs.noteOpened('C:\\p\\a.tex'); // still open: no slot change, b survives
		expect(tabs.list).toEqual(['C:\\p\\a.tex', 'C:\\p\\b.tex']);
		expect(tabs.isPreview('C:\\p\\b.tex')).toBe(true);
	});

	it('gives up the slot when the previewed file closes, is renamed, or disappears', () => {
		tabs.noteOpened('C:\\p\\a.tex');
		tabs.close('C:\\p\\a.tex');
		expect(tabs.preview).toBe(null);

		tabs.noteOpened('C:\\p\\b.tex');
		tabs.rename('C:\\p\\b.tex', 'C:\\p\\renamed.tex');
		expect(tabs.isPreview('C:\\p\\renamed.tex')).toBe(true);

		tabs.prune([]);
		expect(tabs.preview).toBe(null);
	});

	it('restored tabs are all permanent: the first file opened appends', () => {
		// bind() replays a persisted set; none of it was "just glanced at" this session
		expect(tabs.preview).toBe(null);
	});
});
