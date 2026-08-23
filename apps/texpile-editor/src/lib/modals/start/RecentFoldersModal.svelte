<script lang="ts">
	import { X, Folder } from '@lucide/svelte';
	import { basename } from '$lib/workspace/fileSystem';
	import { m } from '$lib/paraglide/messages';

	let {
		open = $bindable(false),
		folders,
		onPick
	}: {
		open: boolean;
		folders: string[];
		onPick: (folder: string) => void;
	} = $props();

	function close() {
		open = false;
	}
	function pick(folder: string) {
		close();
		onPick(folder);
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-1300 flex items-center justify-center app-scrim bg-black/40 p-4"
		role="presentation"
		onmousedown={(e) => e.target === e.currentTarget && close()}
	>
		<div class="card bg-surface-50-950 border-surface-300-700 max-h-full w-full max-w-md overflow-y-auto border p-5 shadow-2xl">
			<div class="mb-3 flex items-center justify-between">
				<h2 class="flex items-center gap-2 text-base font-semibold">
					<Folder class="text-primary-500 size-5" />
					{m.start_recent_heading()}
				</h2>
				<button class="btn-icon btn-icon-xs hover:preset-tonal" onclick={close} aria-label={m.tutorial_close_aria()}>
					<X class="size-4" />
				</button>
			</div>
			{#each folders as folder (folder)}
				<button
					class="hover:preset-tonal group flex w-full min-w-0 items-center gap-3 rounded px-2 py-1.5 text-left text-sm"
					onclick={() => pick(folder)}
					title={folder}
				>
					<Folder class="text-surface-500 size-4 shrink-0" />
					<span class="flex min-w-0 flex-1 items-baseline gap-2">
						<span class="max-w-[45%] shrink-0 truncate group-hover:underline">{basename(folder)}</span>
						<span class="text-surface-400 min-w-0 truncate text-xs">{folder}</span>
					</span>
				</button>
			{/each}
		</div>
	</div>
{/if}
