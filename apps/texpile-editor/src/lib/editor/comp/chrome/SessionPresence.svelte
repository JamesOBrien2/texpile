<script lang="ts">
	// Shared-session presence for the title bar: a live dot, the guest avatars, and the count.
	// Click opens the share dialog.
	//
	// It lives in the title bar's RIGHT block, beside the window buttons, not with the menus. Two
	// reasons. It reads as status rather than as a command, and status belongs at the trailing edge
	// - next to it on the left it looked like a ninth menu that had lost its dropdown. And the left
	// block is what the command center measures itself against: anything in there eats into
	// menuBudget, so opening a session used to push menus into the overflow button.
	import { Users } from '@lucide/svelte';
	import { collabHost } from '$lib/collab/hostStore.svelte';
	import { m } from '$lib/paraglide/messages';

	let { onShareSession }: { onShareSession?: () => void } = $props();

	const count = $derived(collabHost.guestCount());
	const summary = $derived(
		count === 0 ? m.menubar_sharing_waiting() : count === 1 ? m.share_guests_one() : m.share_guests_other({ count })
	);
</script>

{#if collabHost.active}
	<button
		class="app-no-drag hover:bg-surface-200-800 mr-1 flex h-[22px] shrink-0 items-center gap-1.5 self-center rounded px-2 text-xs"
		onclick={() => onShareSession?.()}
		title={m.menubar_share_session()}
	>
		<span class="bg-success-500 size-2 shrink-0 rounded-full"></span>
		<Users class="text-surface-500 size-4 shrink-0" />
		<div class="flex items-center -space-x-1.5">
			{#each collabHost.peers.slice(0, 5) as peer, i (i)}
				<span
					class="border-surface-100-900 flex size-5 items-center justify-center rounded-full border text-[10px] font-bold text-white"
					style="background-color: {peer.color}"
					title={peer.name}>{(peer.name || '?').slice(0, 1).toUpperCase()}</span
				>
			{/each}
		</div>
		<span class="text-surface-600-400 whitespace-nowrap">{summary}</span>
	</button>
{/if}
