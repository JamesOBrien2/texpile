// what the renderer needs before its first render, in one sync call from preload
import { ipcMain } from 'electron';
import { readSettings } from '../appSettings';
import { pendingOpens } from '../windows/windowRegistry';

export function registerBootstrapIpc(): void {
	ipcMain.on('window:bootstrap', (e) => {
		const wcId = e.sender.id;
		// consumed here, or did-finish-load pushes the same open a second time
		const open = pendingOpens.get(wcId) ?? null;
		if (open) pendingOpens.delete(wcId);
		// eslint-disable-next-line no-param-reassign -- returnValue on the event IS how sendSync replies
		e.returnValue = { open, settings: readSettings() };
	});
}
