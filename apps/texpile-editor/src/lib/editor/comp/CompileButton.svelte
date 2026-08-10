<script lang="ts" module>
	/**
	 * The four states the compile slot can be in, and the tonal preset each wears.
	 *
	 * The label is pinned a step darker than the preset's own (800 in light, 200 in dark) because
	 * a tonal preset puts its text on its own tint - the same hue at both ends - which reads as
	 * washed out.
	 *
	 * The hairline is the button's OWN hue at 30%, not a solid one: a full-strength outline round
	 * a pale fill reads as a highlight ring rather than an edge. At 30% it is enough to separate
	 * the button from the toolbar behind it and nothing more.
	 */
	export type CompileTone = 'primary' | 'success' | 'warning' | 'error';
	export const COMPILE_TONE: Record<CompileTone, string> = {
		primary: 'preset-tonal-primary text-primary-800-200 border border-primary-500/30',
		success: 'preset-tonal-success text-success-800-200 border border-success-500/30',
		warning: 'preset-tonal-warning text-warning-800-200 border border-warning-500/30',
		error: 'preset-tonal-error text-error-800-200 border border-error-500/30'
	};
</script>

<script lang="ts">
	// The left half of the topbar's compile split-button. One element wearing whichever state the
	// toolbar is in - Compile, Preview, Live, Paused, Stop - because those differed only in colour,
	// icon, label and click, and five near-identical <button> blocks drifted apart every time one
	// of them was touched. The chevron beside it is the caller's (it belongs to the menu, not to a
	// state) and reads its colour from COMPILE_TONE above, so the pair always matches.
	import type { Component } from 'svelte';

	interface Props {
		tone: CompileTone;
		label: string;
		title: string;
		onclick: () => void;
		/** lucide icon for the leading slot; omit when `dot` marks a running state instead */
		icon?: Component | null;
		/** the filled status dot the live/running states use in place of an icon */
		dot?: boolean;
		/** Stop's fixed narrow width; the other labels need the roomier minimum */
		narrow?: boolean;
	}
	let { tone, label, title, onclick, icon = null, dot = false, narrow = false }: Props = $props();
</script>

<button
	class="btn btn-sm {COMPILE_TONE[tone]} {narrow ? 'w-20' : 'min-w-24'} justify-center gap-1.5 rounded-r-none whitespace-nowrap"
	{onclick}
	{title}
>
	{#if dot}
		<span class="bg-success-500 size-2 rounded-full"></span>
	{:else if icon}
		{@const Icon = icon}
		<Icon class="size-4" />
	{/if}
	{label}
</button>
