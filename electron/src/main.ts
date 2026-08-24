// The composition root: pins the app identity, registers every IPC surface, and owns the
// launch/open/quit lifecycle. Each domain lives in its own module (ipc/, windows/, fs/, ...).
import { app, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyAppIdentity } from './appIdentity';
import { fixShellPath } from './fixShellPath';
import { registerPrivilegedSchemes, registerProtocolHandlers } from './appProtocols';
import { readSettings, writeSettings, registerSettingsIpc } from './appSettings';
import { createWindow, startUrl } from './windows/createWindow';
import { windowRoots, pendingOpens, normRoot, windowFor, focusWindow, beginQuit } from './windows/windowRegistry';
import { registerFsIpc } from './ipc/fsIpc';
import { registerGitIpc } from './ipc/gitIpc';
import { registerDraftIpc } from './ipc/draftIpc';
import { registerPdfSaveIpc } from './ipc/pdfSaveIpc';
import { registerTypstIpc } from './ipc/typstIpc';
import { registerTypstPreviewIpc } from './ipc/typstPreviewIpc';
import { registerTerminalIpc, killAllPtys } from './ipc/terminalIpc';
import { registerWorkspaceWindowIpc } from './ipc/workspaceWindowIpc';
import { registerUpdatesIpc } from './ipc/updatesIpc';
import { registerMcpIpc, mcpHost } from './ipc/mcpIpc';
import { registerWindowChrome } from './windowChrome';
import { registerZotero } from './zotero';
import { registerLibrary } from './library';
import * as draftDaemon from './draft/draftDaemon';
import * as mcp from './mcp/server';

applyAppIdentity();
fixShellPath();
registerPrivilegedSchemes();

registerSettingsIpc();
registerFsIpc();
registerGitIpc();
registerDraftIpc();
registerPdfSaveIpc();
registerTypstIpc();
registerTypstPreviewIpc();
registerTerminalIpc();
registerWorkspaceWindowIpc();
registerUpdatesIpc();
registerMcpIpc();
registerZotero();
registerLibrary();

// .tex handed over by the OS before any window exists; consumed at whenReady
let initialOpenPath: string | null = null;

// OS "Open With": route the file to the window whose workspace contains it, else an
// empty start-screen window, else a fresh window (the VS Code model)
function requestOpenPath(p: string): void {
	if (!p) return;
	const fileNorm = normRoot(p);
	for (const [wcId, r] of windowRoots) {
		if (!r) continue;
		if (fileNorm === r.norm || fileNorm.startsWith(r.norm + path.sep)) {
			const w = windowFor(wcId);
			if (w && !w.webContents.isLoading()) {
				w.webContents.send('main:open-path', p);
				focusWindow(w);
				return;
			}
		}
	}
	for (const [wcId, r] of windowRoots) {
		if (r) continue;
		const w = windowFor(wcId);
		if (!w) continue;
		if (w.webContents.isLoading()) {
			if (!pendingOpens.has(wcId)) {
				pendingOpens.set(wcId, { kind: 'file', path: p });
				focusWindow(w);
				return;
			}
			continue;
		}
		w.webContents.send('main:open-path', p);
		focusWindow(w);
		return;
	}
	if (app.isReady()) focusWindow(createWindow(startUrl(), { kind: 'file', path: p }));
	else initialOpenPath = p;
}

// Windows/Linux file associations put the path in argv; macOS uses the open-file event
function fileFromArgv(argv: string[]): string | null {
	for (const a of argv.slice(1)) {
		if (!a || a.startsWith('-')) continue;
		if (/\.(tex|ltx|latex)$/i.test(a) && fs.existsSync(a)) return path.resolve(a);
	}
	return null;
}

// macOS "Open With" arrives here, possibly before the window (even before ready)
app.on('open-file', (event, filePath) => {
	event.preventDefault();
	requestOpenPath(filePath);
});

// a second launch routes its file to the right window; launching with no file opens a
// fresh window (VS Code model), instead of just focusing the existing one
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.on('second-instance', (_e, argv) => {
		const p = fileFromArgv(argv);
		if (p) requestOpenPath(p);
		else createWindow(startUrl());
	});
}

app.whenReady().then(() => {
	registerProtocolHandlers();
	if (!initialOpenPath) initialOpenPath = fileFromArgv(process.argv);

	// A client is configured once and expects us to be listening; making this a per-launch button
	// would surface the failure as a connection error inside the client, not here. So once granted,
	// it starts with the app. A failure to bind must not stop the editor from opening.
	if (readSettings().mcpEnabled) mcp.start(mcpHost()).catch((e) => console.error('mcp: failed to start', e));

	// Window controls for the custom title bar, plus - on macOS - the native menu bar, built from
	// what the renderer reports about its own menus. Everywhere else the native menu is removed
	// and the renderer draws it. See windowChrome.ts.
	// persisted so the NEXT launch can paint its window buttons in the right colours before a
	// renderer exists to report them; see chromeColors()
	registerWindowChrome((c) =>
		writeSettings({
			chromeHeight: c.height,
			chromeColor: c.color,
			chromeSymbolColor: c.symbolColor,
			chromeBackground: c.background
		})
	);

	if (initialOpenPath) {
		// launched via a .tex file: that request wins over session restore
		createWindow(startUrl(), { kind: 'file', path: initialOpenPath });
		initialOpenPath = null;
	} else {
		// session restore: one window per remembered folder (openFolders), falling back to
		// the pre-multi-window lastFolder slot for existing installs
		const s = readSettings();
		const remembered = Array.isArray(s.openFolders) && s.openFolders.length ? (s.openFolders as string[]) : [];
		const legacy = typeof s.lastFolder === 'string' && s.lastFolder ? [s.lastFolder] : [];
		const folders =
			s.reopenLastFolder !== false
				? [...new Set((remembered.length ? remembered : legacy).map((f) => path.resolve(f)))].filter((f) => {
						try {
							return fs.statSync(f).isDirectory();
						} catch {
							return false;
						}
					})
				: [];
		if (folders.length) for (const f of folders) createWindow(startUrl(), { kind: 'folder', path: f });
		else createWindow(startUrl());
	}

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow(startUrl());
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
	beginQuit(); // freeze the persisted openFolders snapshot before windows start closing
});

// destructive teardown only once the quit is actually happening: the unsaved-edit hold can
// CANCEL a quit, and a cancelled quit must not have killed every shell and the warm engine
app.on('will-quit', () => {
	killAllPtys();
	draftDaemon.stopDaemon();
	// takes the endpoint file with it, so a stale port/token is never left on disk for the bridge
	void mcp.stop();
});
