// The MCP server's window into this process: how it finds windows and roots, and the renderer
// surface for enabling it. The server reports editor state and steers the view; it never writes
// documents. See mcp/server.ts for why it is hosted in-process rather than spawned.
import { app, BrowserWindow, ipcMain } from 'electron';
import * as mcp from '../mcp/server';
import { publishWindowState, type WindowState } from '../mcp/state';
import { deliverResponse } from '../mcp/bridge';
import { readSettings, writeSettings } from '../appSettings';
import { devChannel } from '../appIdentity';
import { windowRoots, windowWithRoot } from '../windows/windowRegistry';

function mcpPort(): number {
	const configured = Number(readSettings().mcpPort) || 0;
	return configured > 0 ? configured : devChannel ? mcp.PORT_DEFAULT_DEV : mcp.PORT_DEFAULT;
}

export function mcpHost(): mcp.McpHost {
	return {
		userDataDir: app.getPath('userData'),
		port: mcpPort(),
		windows: () => BrowserWindow.getAllWindows().map((w) => ({ webContentsId: w.webContents.id, focused: w.isFocused() })),
		rootFor: (wcId) => windowRoots.get(wcId)?.raw ?? null,
		windowObjects: () => BrowserWindow.getAllWindows(),
		windowFor: (root) => {
			// by root when given: focus follows the user's clicks, so a tool that always used the
			// focused window would steer whichever project they happened to be looking at
			const win = root ? windowWithRoot(root) : (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null);
			if (!win) return null;
			return { win, root: windowRoots.get(win.webContents.id)?.raw ?? null };
		},
		onConnectionChange: (client) => {
			for (const w of BrowserWindow.getAllWindows()) w.webContents.send('mcp:connection', client);
		}
	};
}

export function registerMcpIpc(): void {
	ipcMain.handle('mcp:status', () => ({ ...mcp.status(), enabled: !!readSettings().mcpEnabled }));
	ipcMain.handle('mcp:setEnabled', async (_e, enabled: boolean) => {
		writeSettings({ mcpEnabled: !!enabled });
		if (enabled) await mcp.start(mcpHost());
		else await mcp.stop();
		return { ...mcp.status(), enabled: !!enabled };
	});
	// renderers push what they are showing; see mcp/state.ts for why this is a push and not a pull
	// a renderer answering an mcp:request (get_unsaved, get_diagnostics)
	ipcMain.on('mcp:response', (_e, payload: { id: number; data: unknown }) => {
		if (payload && typeof payload.id === 'number') deliverResponse(payload.id, payload.data);
	});
	ipcMain.on('mcp:publishState', (e, state: Omit<WindowState, 'updatedAt'>) => {
		publishWindowState(e.sender.id, state);
	});
}
