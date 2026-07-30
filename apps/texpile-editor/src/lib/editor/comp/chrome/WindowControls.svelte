<script lang="ts">
	// Minimise / maximise / close for the frameless window. Windows and Linux only: on macOS the
	// window keeps its frame and the traffic lights, so drawing a second set of buttons would be
	// both wrong and unusable.
	//
	// Sizing follows the Windows convention (46x32 hit targets, close turns red) because that is
	// what a Windows user's pointer expects to find in the corner, not because it is pretty.
	import { onMount } from 'svelte';
	// lucide, like every other icon in the app. Native title bars use 10px 1px-stroke glyphs; these
	// are 14px at stroke 1.5, which is as close as lucide gets while still matching our own toolbars.
	// Copy is the conventional restore glyph (two offset squares), not a copy action here.
	import { Minus, Square, Copy, X } from '@lucide/svelte';
	import { native } from '$lib/workspace/fileSystem';
	import { m } from '$lib/paraglide/messages';

	interface NativeWindow {
		windowMinimize?: () => Promise<void>;
		windowToggleMaximize?: () => Promise<boolean>;
		windowClose?: () => Promise<void>;
		windowIsMaximized?: () => Promise<boolean>;
		onWindowState?: (cb: (s: { maximized: boolean; fullScreen: boolean }) => void) => () => void;
	}
	const api = () => native() as NativeWindow | undefined;

	let maximized = $state(false);

	onMount(() => {
		const n = api();
		// the window may already be maximised when this mounts (restored session, snapped launch)
		void n?.windowIsMaximized?.().then((v) => (maximized = v));
		// double-clicking the drag region also maximises, so the state has to be pushed, not polled
		return n?.onWindowState?.((s) => (maximized = s.maximized));
	});

	// app-no-drag: these sit inside the title bar's drag region, which would otherwise swallow the
	// click. The hover fill is NOT in here: close needs a red one, and two hover:bg utilities on one
	// element resolve by stylesheet order rather than class order, so which wins is not ours to decide.
	const btn = 'app-no-drag flex h-8 w-[46px] items-center justify-center';
	const plainBtn = `${btn} hover:bg-surface-200-800`;
	// The close cross gets a bigger box than the minimise bar and the maximise square, matching the
	// native Windows controls: a cross only touches the corners of its box while a bar and a square
	// each fill an edge, so at equal box size the cross reads noticeably smaller. 12 against 16.
	const ICON = { size: 12, strokeWidth: 1.5 };
	const CLOSE_ICON = { size: 16, strokeWidth: 1.5 };
</script>

<div class="flex shrink-0 items-stretch">
	<button class={plainBtn} aria-label={m.titlebar_minimize()} title={m.titlebar_minimize()} onclick={() => api()?.windowMinimize?.()}>
		<Minus {...ICON} />
	</button>
	<button
		class={plainBtn}
		aria-label={maximized ? m.titlebar_restore() : m.titlebar_maximize()}
		title={maximized ? m.titlebar_restore() : m.titlebar_maximize()}
		onclick={() => api()?.windowToggleMaximize?.()}
	>
		{#if maximized}
			<Copy {...ICON} />
		{:else}
			<Square {...ICON} />
		{/if}
	</button>
	<button class="{btn} close-btn" aria-label={m.titlebar_close()} title={m.titlebar_close()} onclick={() => api()?.windowClose?.()}>
		<X {...CLOSE_ICON} />
	</button>
</div>

<style>
	/*
	 * ONE red for closing, and it is the app's own destructive red rather than a platform one.
	 *
	 * error-700, not 500. The delete affordances use preset-tonal-error, which Skeleton defines as
	 * --color-error-50-950 on --color-error-950-50: the red you actually SEE in the file explorer is
	 * the deep end of the ramp, not the mid one, and app.css reaches for --color-error-700 wherever it
	 * needs destructive red as a foreground. 500 read noticeably brighter than the rest of the app.
	 *
	 * Written as the variable, not a Tailwind `hover:bg-error-700`, so it cannot lose to another
	 * hover:bg utility on stylesheet order - and not copied as a literal, so retuning the theme's red
	 * moves this with it.
	 *
	 * There is no platform red to match instead. macOS never reaches this component: the traffic
	 * lights are drawn by the OS and their red is Apple's. Linux has no convention at all - GNOME's
	 * close button is a neutral circle that never reddens, and every desktop environment differs.
	 * Windows' own is #C42B1C, but hard-coding it would give the app two different reds for the same
	 * idea, on one platform only.
	 *
	 * Solid, not the tonal wash the delete buttons use: a title-bar close is the one control expected
	 * to fill, and a pale tint there would read as disabled.
	 */
	.close-btn:hover {
		background-color: var(--color-error-700);
		color: #fff;
	}
</style>
