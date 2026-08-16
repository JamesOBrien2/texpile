<script lang="ts">
	// Renders inline `code` spans from backtick-delimited segments in otherwise plain text, for LaTeX
	// commands and template placeholders (\ref{label}, {main}) embedded in a sentence. These are all
	// short, well-known patterns, so a hand-rolled tokenizer colors them without pulling the
	// build-time Shiki highlighter (used for the one real code block, on the Compiling page) into
	// every single inline mention. Colors match Shiki's github-light palette for consistency.
	import { tokenize } from './prose';

	let { text }: { text: string } = $props();

	const parts = $derived(text.split(/(`[^`]+`)/g).filter((s) => s !== ''));
</script>

{#each parts as part, i (i)}
	{#if part.startsWith('`') && part.endsWith('`')}
		<code class="bg-surface-100 rounded px-1 py-0.5 font-mono text-[0.9em]"
			>{#each tokenize(part.slice(1, -1)) as tok, j (j)}<span class={tok.class} style={tok.color ? `color:${tok.color}` : undefined}
					>{tok.text}</span
				>{/each}</code
		>
	{:else}
		{part}
	{/if}
{/each}
