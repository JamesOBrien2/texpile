<script lang="ts">
	// The Texpile icon in the title bar, as an app menu.
	//
	// This is the Windows/Linux half of a pair. macOS has a real application menu - the one named after
	// the app, next to the Apple menu - and Preferences and Share session belong there by convention,
	// not in File. Off macOS there is no such menu, so the app icon becomes it. window-chrome.ts builds
	// the macOS side with the same two items so the two platforms agree on where these live.
	import { Menu, Portal } from '@skeletonlabs/skeleton-svelte';
	import { preferencesOpen } from '$lib/stores/dialogStore';
	import iconUrl from '$lib/assets/logo/Logo-icon.svg';
	import { isMac } from '$lib/platform';
	import { m } from '$lib/paraglide/messages';

	const appVersion = __APP_VERSION__; // injected by Vite from package.json

	let { onShareSession }: { onShareSession?: () => void } = $props();

	function select(value: string) {
		if (value === 'preferences') preferencesOpen.set(true);
		else if (value === 'share-session') onShareSession?.();
	}

	const contentClass = 'card bg-surface-50-950 border-surface-200-800 z-[1200] flex min-w-48 flex-col gap-0 border p-1 shadow-xl';
	const itemClass =
		'flex cursor-pointer items-center justify-between gap-6 rounded-base px-2.5 py-1 text-sm hover:preset-tonal data-[disabled]:opacity-40';
</script>

<!-- no-drag, or the surrounding title bar's drag region eats the click that opens this -->
<Menu onSelect={(d) => select(d.value)}>
	<!--
		A square hover target with the mark dead centre in it.

		Spacing is MARGIN, not padding, and that is the whole trick: hover:preset-tonal fills the
		trigger's box, so asymmetric padding shows up as an off-centre logo inside the highlight (which
		is what pl-2.5/pr-1 was doing). Margin sits outside the painted area, so the gap and the
		centring stop competing - ml-1 alone, no mr, because the mark should read as the first item in
		the bar rather than as something parked beside it.

		size-6, not larger: the square's own padding is what separates the mark from File, so a bigger
		box would push them apart again. 24px around a 16px mark leaves 4px a side, which lands the gap
		to the File label at the same ~14px rhythm the menu labels keep between themselves.
	-->
	<Menu.Trigger
		class="app-no-drag rounded-base ml-1 flex size-6 shrink-0 items-center justify-center self-center hover:preset-tonal"
		aria-label={m.titlebar_app_menu()}
	>
		<!-- app-titlebar-icon: rides 1px high so the SQUARE sits on the labels' cap line, not the arms.
		     See app.css for the derivation. -->
		<img src={iconUrl} alt="" class="app-titlebar-icon size-4" draggable="false" />
	</Menu.Trigger>
	<Portal>
		<Menu.Positioner>
			<Menu.Content class={contentClass}>
				<Menu.Item value="preferences" class={itemClass}>
					<Menu.ItemText>{m.menubar_preferences()}</Menu.ItemText>
					<span class="opacity-50">{isMac ? '⌘,' : 'Ctrl+,'}</span>
				</Menu.Item>
				{#if onShareSession}
					<Menu.Item value="share-session" class={itemClass}><Menu.ItemText>{m.menubar_share_session()}</Menu.ItemText></Menu.Item>
				{/if}
				<Menu.Separator class="border-surface-200-800 my-1 border-t" />
				<div class="text-surface-500 px-2.5 py-1 text-xs">{m.menubar_version_footer({ version: appVersion })}</div>
			</Menu.Content>
		</Menu.Positioner>
	</Portal>
</Menu>
