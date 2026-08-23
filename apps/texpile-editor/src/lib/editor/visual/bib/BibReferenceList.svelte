<script lang="ts">
	// The reference rows on the manager's left: author/title/year summary, a raw badge for
	// entries that only edit as CM text, and per-row delete.
	import { Code, Trash2 } from '@lucide/svelte';
	import { fitsVisualEditor, type BiblatexReference } from '$lib/languages/bib/biblatex';
	import { m } from '$lib/paraglide/messages';

	let {
		refs,
		selectedKey,
		onEdit,
		onDelete
	}: {
		refs: BiblatexReference[];
		/** the key being edited, so its row stays highlighted */
		selectedKey: string | null;
		onEdit: (ref: BiblatexReference) => void;
		onDelete: (key: string) => void;
	} = $props();
</script>

{#if refs.length === 0}
	<li class="text-surface-500 flex h-40 items-center justify-center rounded border border-dashed text-sm">
		{m.bib_no_references_empty()}
	</li>
{:else}
	{#each refs as ref (ref.key)}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
		<li
			class="mb-2 flex cursor-pointer items-center justify-between gap-2 rounded border p-3 transition-colors {ref.key === selectedKey
				? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30'
				: 'border-surface-200-800 hover:bg-surface-100-900'}"
			onclick={() => onEdit(ref)}
		>
			<div class="pointer-events-none min-w-0 flex-1">
				<div class="truncate text-sm font-semibold">{ref.author || m.bib_unknown_author_placeholder()}</div>
				<div class="text-surface-600-400 truncate text-xs">{ref.title || m.bib_untitled_placeholder()}</div>
				<div class="text-surface-500 mt-1 flex items-center gap-2 text-xs">
					<span>{ref.year || m.bib_no_year_placeholder()}</span>
					<span>•</span>
					<code class="text-xs">{ref.key}</code>
					{#if !fitsVisualEditor(ref)}
						<!-- raw badge: this row edits as raw CM -->
						<span
							class="border-surface-300-700 text-surface-500 inline-flex items-center gap-0.5 rounded border px-1 py-px text-[10px]"
							title={m.bib_raw_badge_list_tooltip()}
						>
							<Code class="size-2.5" />
							{m.bib_raw_badge_text()}
						</span>
					{/if}
				</div>
			</div>
			<button
				type="button"
				class="btn-icon btn-icon-xs hover:preset-tonal-error shrink-0"
				onclick={(e) => {
					e.stopPropagation();
					onDelete(ref.key);
				}}
				title={m.bib_delete_tooltip()}
			>
				<Trash2 class="size-4" />
			</button>
		</li>
	{/each}
{/if}
