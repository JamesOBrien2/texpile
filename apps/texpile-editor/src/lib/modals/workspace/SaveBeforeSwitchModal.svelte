<script lang="ts">
	// Autosave off + unsaved edits, and the user is switching away: keep, drop, or stay put.
	// Three outcomes, so this can't be the boolean confirmAsk(): the X / backdrop / Escape all
	// CANCEL the switch (stay on the current file with the edit intact), not save it.
	import Modal from '../Modal.svelte';
	import { m } from '$lib/paraglide/messages';

	let { name, onResolve }: { name: string; onResolve: (choice: 'save' | 'discard' | 'cancel') => void } = $props();
</script>

<Modal title={m.wsview_unsaved_title()} onClose={() => onResolve('cancel')} alert onEnter={() => onResolve('save')}>
	<p class="text-surface-600-300 text-sm">{m.wsview_confirm_save_before_switch({ name })}</p>
	<div class="mt-5 flex justify-end gap-2">
		<button class="btn hover:preset-tonal" type="button" onclick={() => onResolve('discard')}>{m.vcs_discard_changes()}</button>
		<button class="btn preset-filled-primary-500" type="button" onclick={() => onResolve('save')}>{m.wsview_save_label()}</button>
	</div>
</Modal>
