<script lang="ts">
	// Open-file tabs on a dedicated strip above the editor. Tabs shrink as the count grows; past
	// the point where another one would be narrower than MIN_TAB_PX the strip stops growing and
	// the leftovers move into a dropdown, so the bar never scrolls out from under the pointer.
	import { X, ChevronDown } from '@lucide/svelte';
	import { Popover, Portal } from '@skeletonlabs/skeleton-svelte';
	import { basename, samePath } from '$lib/workspace/fileSystem';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		tabs: string[];
		activePath: string | null;
		/** only the active file can be dirty (switching files flushes saves). */
		dirty: boolean;
		/** the unedited PREVIEW tab, shown in italics; the next file opened takes its slot. */
		previewPath?: string | null;
		onActivate: (path: string) => void;
		onClose: (path: string) => void;
		/** double-click keeps a preview tab (the only way to hold one you never edit, e.g. a PDF). */
		onKeep?: (path: string) => void;
	};
	let { tabs, activePath, dirty, previewPath = null, onActivate, onClose, onKeep }: Props = $props();

	function isActive(t: string) {
		return !!activePath && samePath(t, activePath);
	}

	/** a tab narrower than this is unreadable, so it goes in the dropdown instead.
	 *  drives the tabs' CSS min-width directly - do not restate it as a class. */
	const MIN_TAB_PX = 96;
	/** the overflow button's own footprint, reserved before dividing up the rest */
	const OVERFLOW_PX = 44;

	let stripWidth = $state(0);

	/** how many tabs the strip can show without any of them dropping below MIN_TAB_PX. Each tab
	 *  carries that as its CSS min-width, so this count is exact rather than an estimate. */
	const capacity = $derived(
		stripWidth === 0 || tabs.length * MIN_TAB_PX <= stripWidth
			? tabs.length
			: Math.max(1, Math.floor((stripWidth - OVERFLOW_PX) / MIN_TAB_PX))
	);
	const overflowing = $derived(capacity < tabs.length);

	// The visible window slides only as far as it must to reach the active tab, the way a scroll
	// position does - recomputing it from the active index every time would shuffle the strip on
	// every switch.
	let windowStart = $state(0);
	$effect(() => {
		const max = Math.max(0, tabs.length - capacity);
		const i = activePath ? tabs.findIndex((t) => samePath(t, activePath)) : -1;
		let start = Math.min(windowStart, max);
		if (i >= 0) {
			if (i < start) start = i;
			else if (i >= start + capacity) start = i - capacity + 1;
		}
		if (start !== windowStart) windowStart = start;
	});

	const visible = $derived(tabs.slice(windowStart, windowStart + capacity));

	let menuOpen = $state(false);
	function chooseFromMenu(path: string) {
		menuOpen = false;
		onActivate(path);
	}
</script>

{#if tabs.length > 0}
	<div
		class="bg-surface-100-900 border-surface-200-800 relative z-20 flex h-9 shrink-0 items-stretch overflow-hidden border-b"
		role="tablist"
		bind:clientWidth={stripWidth}
	>
		{#each visible as tab (tab)}
			<div
				class="group border-surface-200-800 flex shrink cursor-pointer items-center gap-1.5 border-r px-3 text-sm {isActive(tab)
					? 'bg-surface-50-950'
					: 'text-surface-600-400 hover:bg-surface-200-800/60'}"
				style="min-width: {MIN_TAB_PX}px; max-width: 15rem"
				role="tab"
				aria-selected={isActive(tab)}
				tabindex="0"
				title={tab}
				onclick={() => onActivate(tab)}
				ondblclick={() => onKeep?.(tab)}
				onkeydown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onActivate(tab);
					}
				}}
				onauxclick={(e) => {
					if (e.button === 1) onClose(tab);
				}}
			>
				<span class="truncate leading-none" class:italic={!!previewPath && samePath(tab, previewPath)}>{basename(tab)}</span>
				<!-- fixed-size trailing slot: dirty dot and close button share it, so neither ever
				     changes the tab's width; hovering swaps the dot for the close button.
				     ml-auto keeps it on the right edge when the name leaves slack -->
				<span class="-mr-1 ml-auto flex size-5 shrink-0 items-center justify-center">
					{#if isActive(tab) && dirty}
						<span class="bg-warning-500 size-2 rounded-full group-hover:hidden" title={m.wsview_unsaved_changes()}></span>
					{/if}
					<button
						class="hover:bg-surface-300-700 items-center justify-center rounded p-0.5 {isActive(tab) && dirty
							? 'hidden group-hover:inline-flex'
							: isActive(tab)
								? 'inline-flex'
								: 'inline-flex opacity-0 group-hover:opacity-100'}"
						onclick={(e) => {
							e.stopPropagation();
							onClose(tab);
						}}
						aria-label={m.tabs_close()}
						title={m.tabs_close()}
					>
						<X class="size-3.5" />
					</button>
				</span>
			</div>
		{/each}

		{#if overflowing}
			<Popover
				open={menuOpen}
				onOpenChange={(e) => (menuOpen = e.open)}
				positioning={{ placement: 'bottom-end', offset: { mainAxis: 2 } }}
				autoFocus={false}
			>
				<Popover.Trigger
					class="text-surface-600-400 hover:bg-surface-200-800/60 ml-auto flex shrink-0 items-center gap-0.5 px-2 text-sm"
					aria-label={m.tabs_show_all({ count: tabs.length })}
					title={m.tabs_show_all({ count: tabs.length })}
				>
					<span class="tabular-nums">{tabs.length - capacity}</span>
					<ChevronDown class="size-4" />
				</Popover.Trigger>
				<Portal>
					<Popover.Positioner class="z-floating-ui">
						<Popover.Content class="card bg-surface-50-950 border-surface-300-700 max-h-96 min-w-[240px] overflow-y-auto border shadow-lg">
							<div class="py-1">
								{#each tabs as tab (tab)}
									<button
										type="button"
										class="hover:preset-tonal-primary flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
										class:preset-tonal-primary={isActive(tab)}
										title={tab}
										onclick={() => chooseFromMenu(tab)}
									>
										<span class="truncate" class:italic={!!previewPath && samePath(tab, previewPath)}>{basename(tab)}</span>
									</button>
								{/each}
							</div>
						</Popover.Content>
					</Popover.Positioner>
				</Portal>
			</Popover>
		{/if}
	</div>
{/if}
