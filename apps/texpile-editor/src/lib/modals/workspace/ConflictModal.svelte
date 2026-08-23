<script lang="ts">
	// The file changed on disk while we held unsaved edits: reload or keep ours.
	import Modal from '../Modal.svelte';
	import { basename } from '$lib/workspace/fileSystem';
	import { m } from '$lib/paraglide/messages';

	let {
		path,
		onResolve
	}: {
		path: string;
		onResolve: (choice: 'reload' | 'keep') => void;
	} = $props();
</script>

<Modal dismissable={false} title={m.wsview_conflict_title()}>
	<p class="text-surface-600-300 text-sm">
		<span class="font-medium">{basename(path)}</span>
		{m.wsview_conflict_body()}
	</p>
	<div class="mt-5 flex justify-end gap-2">
		<button class="btn hover:preset-tonal" onclick={() => onResolve('reload')}>{m.wsview_reload_from_disk()}</button>
		<button class="btn preset-filled-primary-500" onclick={() => onResolve('keep')}>{m.wsview_keep_my_version()}</button>
	</div>
</Modal>
