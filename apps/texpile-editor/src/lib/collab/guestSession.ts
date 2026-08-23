import type { EditSession } from './editSession';
import { spliceDiff, EDIT_ORIGIN } from './materialize';
import { collabGuest } from './guestStore.svelte';

// adapts the guest controller to the EditSession shape WorkspaceView drives; host-only methods
// are no-ops (a guest owns no disk, never materializes, never compiles)
export const guestSession: EditSession = {
	get active() {
		return collabGuest.status === 'online' || collabGuest.status === 'reconnecting';
	},
	isGuest: true,
	get manifestRev() {
		return collabGuest.rev;
	},
	get guestPdf() {
		return collabGuest.pdf;
	},
	onCompileRequest: null,
	onSyncRequest: null,
	onFileOp: null,
	shareCompileIntel() {},
	get compileIntel() {
		return collabGuest.compileIntel;
	},
	sharedKindOf(path) {
		if (!path) return null;
		return collabGuest.files.find((f) => f.rel === path)?.kind ?? null;
	},
	collabFor(path) {
		if (!path) return null;
		const ytext = collabGuest.ytextFor(path);
		const awareness = collabGuest.awareness;
		return ytext && awareness ? { ytext, awareness, readOnly: collabGuest.isLocked(path) } : null;
	},
	// the guest visual editor's write path: fold the serialized doc into the shared Y.Text as a
	// minimal splice; the change syncs to the host, whose materializer lands it on disk. The
	// source editor is Y-bound, so its calls arrive content-equal and splice nothing.
	edit(path, content) {
		if (!path || collabGuest.isLocked(path)) return;
		const t = collabGuest.ytextFor(path);
		if (!t) return;
		const diff = spliceDiff(t.toString(), content.replace(/\r\n?/g, '\n'));
		if (!diff) return;
		t.doc?.transact(() => {
			if (diff.remove > 0) t.delete(diff.index, diff.remove);
			if (diff.insert) t.insert(diff.index, diff.insert);
		}, EDIT_ORIGIN);
	},
	async beforeOpen() {},
	setVisualLock() {},
	async syncTree() {},
	async pushPdf() {},
	async end() {
		collabGuest.leave();
	},
	guestCount() {
		return collabGuest.peers.length;
	}
};
