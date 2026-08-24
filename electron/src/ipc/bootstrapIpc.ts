// Everything the renderer needs BEFORE its first render, answered in one synchronous call from
// preload. Pushing the folder on did-finish-load instead meant the renderer had already mounted
// the start screen by the time it learned it was restoring a workspace, so every restored window
// painted Start, threw it away, and only then began loading the editor.
import { ipcMain } from 'electron';
import { readSettings } from '../appSettings';
import { pendingOpens } from '../windows/windowRegistry';

export function registerBootstrapIpc(): void {
	ipcMain.on('window:bootstrap', (e) => {
		const wcId = e.sender.id;
		// consumed here, so createWindow's did-finish-load push doesn't open it a second time. A
		// pending open queued AFTER this call (a .tex handed to a still-loading window) still goes
		// out on that push.
		const open = pendingOpens.get(wcId) ?? null;
		if (open) pendingOpens.delete(wcId);
		// eslint-disable-next-line no-param-reassign -- returnValue on the event IS how sendSync replies
		e.returnValue = { open, settings: readSettings() };
	});
}
