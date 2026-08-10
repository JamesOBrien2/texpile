<script lang="ts" module>
	/** the four states the compile slot can be in, and the tonal preset each wears */
	export type CompileTone = 'primary' | 'success' | 'warning' | 'error';
	export const COMPILE_TONE: Record<CompileTone, string> = {
		primary: 'preset-tonal-primary',
		success: 'preset-tonal-success',
		warning: 'preset-tonal-warning',
		error: 'preset-tonal-error'
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
