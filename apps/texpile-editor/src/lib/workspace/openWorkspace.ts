// Opening a folder into this window: one sequence, shared by the launch bootstrap, the main
// process's later pushes (OS "Open With", Open Folder in New Window) and the start screen.
import { navigate } from '$lib/router.svelte';
import { claimWorkspace, dirname, nativeBridge, samePath, scanTexFiles, statFile } from './fileSystem';
import { latexParserWorker } from './latexParserWorker';
import { activeFilePath, addRecentFolder, savedLastFile, texFiles, workspaceRoot } from './workspaceStore';

export type BootOpen = { kind: 'file' | 'folder'; path: string };

/** what the main process handed this window at creation, or null for a plain start screen. */
export function bootOpen(): BootOpen | null {
	return nativeBridge()?.bootstrap?.open ?? null;
}

/** show the folder now; the scan, and the file to land on, arrive through fill() */
function show(root: string): void {
	workspaceRoot.current = root;
	texFiles.current = [];
	activeFilePath.current = null;
	addRecentFolder(root);
	navigate('/workspace');
}

// The scan and the last-file check go out together. Resolving the file after the scan put two
// round trips in front of the document for no reason: which file to reopen comes from storage,
// not from the scan, so only its existence check has to wait on anything.
async function fill(root: string, want: string | null): Promise<void> {
	const [scanned, wantExists] = await Promise.all([
		scanTexFiles(root),
		want ? statFile(want).then((s) => s.exists) : Promise.resolve(false)
	]);
	if (workspaceRoot.current !== root) return; // moved on while we scanned
	const files = scanned.files;
	// the scan's casing wins where it has the file: the tree matches paths as strings
	const landing = want && wantExists ? (files.find((f) => samePath(f.path, want))?.path ?? want) : null;
	texFiles.current = files;
	activeFilePath.current = landing ?? files[0]?.path ?? null;
}

/** the launch path: main created this window for this folder, so it is shown without asking */
export function adoptBootOpen(open: BootOpen): void {
	const root = open.kind === 'file' ? dirname(open.path) : open.path;
	// a document is certain here, so the parser worker boots alongside the editor chunk instead
	// of after it
	latexParserWorker();
	show(root);
	void fill(root, open.kind === 'file' ? open.path : savedLastFile(root)).catch(() => {});
}

/** a folder pushed at a window that is already running; a lost claim leaves it where it was */
export async function openFolderInWindow(root: string): Promise<void> {
	try {
		if (!(await claimWorkspace(root)).ok) return;
		show(root);
		await fill(root, savedLastFile(root));
	} catch {
		/* folder is gone or unreadable: stay where we are */
	}
}

/** OS "Open With": open the file's folder and land on the file itself */
export async function openFileInWindow(filePath: string): Promise<void> {
	const root = dirname(filePath);
	try {
		// main routes files to the window already owning the folder, so a failed claim (folder open
		// elsewhere) only happens in odd races; that window was focused
		if (!(await claimWorkspace(root)).ok) return;
		show(root);
		await fill(root, filePath);
	} catch {
		/* ignore an OS open we can't honor */
	}
}
