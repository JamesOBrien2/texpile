<script lang="ts">
	// Confirm before the formatter rewrites the open file in place: latexindent for .tex,
	// tinymist's built-in typstyle for .typ.
	import { Loader2, TriangleAlert } from '@lucide/svelte';
	import Modal from '../Modal.svelte';
	import { m } from '$lib/paraglide/messages';

	let {
		open = $bindable(),
		formatting,
		tool,
		onFormat
	}: {
		open: boolean;
		formatting: boolean;
		/** which formatter will run; names the tool and picks the caveat text */
		tool: 'latexindent' | 'typstyle';
		onFormat: () => void;
	} = $props();
</script>

<Modal bind:open title={m.wsview_format_modal_title()} icon={TriangleAlert} iconClass="text-warning-500">
	<p class="text-surface-600-300 mb-4 text-sm">
		{#if tool === 'typstyle'}
			{m.wsview_format_desc_typst_pre()}
			<code class="bg-surface-200-800 rounded px-1">typstyle</code>{m.wsview_format_desc_typst_post()}
		{:else}
			{m.wsview_format_desc_pre()} <code class="bg-surface-200-800 rounded px-1">latexindent</code>{m.wsview_format_desc_post()}
		{/if}
	</p>
	<div class="flex justify-end gap-2">
		<button class="btn btn-xs hover:preset-tonal" onclick={() => (open = false)}>{m.wsview_cancel_label()}</button>
		<button class="btn btn-xs preset-filled-primary-500 gap-1.5" onclick={onFormat} disabled={formatting}>
			{#if formatting}<Loader2 class="size-4 animate-spin" />{/if}
			{m.wsview_format_button()}
		</button>
	</div>
</Modal>
