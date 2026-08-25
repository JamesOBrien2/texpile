<script lang="ts">
	import TitleBar from './TitleBar.svelte';
	import { layout } from '$lib/storage/layout';

	const sidebarWidth = $derived(layout.current.sidebarOpen ? layout.current.sidebarWidth : 0);
</script>

<div class="flex h-screen flex-col overflow-hidden">
	<TitleBar />
	<div class="flex min-h-0 flex-1">
		{#if sidebarWidth}
			<div class="bg-surface-100-900 border-surface-300-700 shrink-0 border-r" style="width: {sidebarWidth}px"></div>
		{/if}
		<div class="min-w-0 flex-1"></div>
	</div>
</div>
