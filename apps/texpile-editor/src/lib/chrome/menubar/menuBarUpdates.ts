import { get } from 'svelte/store';
import { checkForUpdate, updateModalOpen, updateState } from '$lib/updates';
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';

const appVersion = __APP_VERSION__; // injected by Vite from package.json

export async function checkUpdates(): Promise<void> {
	// a check while a download is in flight would reset the state; just reopen the modal
	const phase = get(updateState).phase;
	if (phase === 'downloading' || phase === 'downloaded') {
		updateModalOpen.set(true);
		return;
	}
	const status = await checkForUpdate(true);
	if (status === 'update') updateModalOpen.set(true);
	else if (status === 'none')
		toaster.info({
			title: m.menubar_update_none_title(),
			description: m.menubar_update_none_description({ version: appVersion })
		});
	else if (status === 'error') toaster.error({ title: m.menubar_update_error_title(), description: m.menubar_update_error_description() });
	else toaster.info({ title: m.menubar_update_unavailable_title() });
}
