<script lang="ts">
	// Renders the singleton confirmAsk() dialog. Mounted once at app root, like the toast group.
	// Escape / backdrop clicks dismiss it as a cancel.
	import Modal from './Modal.svelte';
	import { confirmDialog, answerConfirm, dismissConfirm } from './confirm.svelte';
	import { m } from '$lib/paraglide/messages';

	const state = $derived(confirmDialog.state);
</script>

{#if state}
	<Modal onClose={dismissConfirm} alert onEnter={() => answerConfirm(true)}>
		<p class="text-surface-600-300 text-sm whitespace-pre-line">{state.message}</p>
		<div class="mt-5 flex justify-end gap-2">
			<button class="btn hover:preset-tonal" type="button" onclick={() => answerConfirm(false)}>
				{state.cancelLabel ?? m.menubar_prompt_cancel()}
			</button>
			<button
				class="btn {state.danger ? 'preset-tonal-error' : 'preset-filled-primary-500'}"
				type="button"
				onclick={() => answerConfirm(true)}
			>
				{state.confirmLabel}
			</button>
		</div>
	</Modal>
{/if}
