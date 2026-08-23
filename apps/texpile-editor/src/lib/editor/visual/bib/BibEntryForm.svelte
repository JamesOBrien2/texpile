<script lang="ts">
	// The typed entry form: type picker, per-type fields, and the citation key under Advanced.
	// BibManager owns the reference list, validation, and the save/commit path.
	import { ChevronDown } from '@lucide/svelte';
	import type { BiblatexReference } from '$lib/languages/bib/biblatex';
	import { getFieldsForType } from '$lib/languages/bib/fieldConfig';
	import { generateLabel } from '$lib/editor/visual/label';
	import { m } from '$lib/paraglide/messages';

	let {
		currentReference = $bindable(),
		formErrors,
		entryTypeOptions,
		isEditing,
		onSave,
		onCancel
	}: {
		currentReference: Partial<BiblatexReference>;
		formErrors: Record<string, string[]>;
		entryTypeOptions: Array<{ value: string; label: string }>;
		isEditing: boolean;
		onSave: () => void;
		onCancel: () => void;
	} = $props();

	let showAdvanced = $state(false);

	const currentFields = $derived(currentReference.entrytype ? getFieldsForType(currentReference.entrytype) : []);
	const regularFields = $derived(currentFields.filter((f) => f.name !== 'key'));
	const keyField = $derived(currentFields.find((f) => f.name === 'key'));
</script>

<form
	onsubmit={(e) => {
		e.preventDefault();
		onSave();
	}}
>
	<label class="label mb-3 block">
		<span class="text-sm font-medium">{m.bib_type_label()}</span>
		<select class="input mt-1 w-full" bind:value={currentReference.entrytype}>
			<option value="">{m.bib_select_type_option()}</option>
			{#each entryTypeOptions as opt (opt.value)}<option value={opt.value}>{opt.label}</option>{/each}
		</select>
		{#if formErrors.entrytype}<p class="text-error-500 text-sm">{formErrors.entrytype[0]}</p>{/if}
	</label>

	{#each regularFields as field (field.name)}
		<label class="label mb-3 block">
			<span class="text-sm font-medium"
				>{field.label}{#if field.required}<span class="text-error-500">*</span>{/if}</span
			>
			{#if field.type === 'textarea'}
				<textarea class="input mt-1 w-full" rows="3" placeholder={field.placeholder} bind:value={currentReference[field.name]}></textarea>
			{:else}
				<input
					class="input mt-1 w-full"
					type={field.type === 'number' ? 'number' : 'text'}
					placeholder={field.placeholder}
					bind:value={currentReference[field.name]}
				/>
			{/if}
			{#if formErrors[field.name]}<p class="text-error-500 text-sm">{formErrors[field.name][0]}</p>{/if}
		</label>
	{/each}

	{#if currentReference.entrytype}
		<button type="button" class="text-surface-600-400 my-2 flex items-center gap-2 text-sm" onclick={() => (showAdvanced = !showAdvanced)}>
			<ChevronDown class="size-4 transition-transform {showAdvanced ? 'rotate-180' : ''}" />
			{m.bib_advanced_citation_key_button()}
		</button>
		{#if showAdvanced && keyField}
			<label class="label mb-3 block pl-6">
				<span class="text-sm font-medium">{m.bib_key_label()}</span>
				<input class="input mt-1 w-full text-sm" type="text" bind:value={currentReference.key} placeholder={generateLabel('citation')} />
				{#if formErrors.key}<p class="text-error-500 text-sm">{formErrors.key[0]}</p>{/if}
			</label>
		{/if}
	{/if}

	{#if formErrors.form}<p class="text-error-500 text-sm">{formErrors.form[0]}</p>{/if}

	<div class="mt-3 flex justify-end gap-2">
		{#if isEditing}<button class="btn hover:preset-tonal" type="button" onclick={onCancel}>{m.bib_cancel_button()}</button>{/if}
		<button class="btn preset-filled-primary-500" type="submit"
			>{isEditing ? m.bib_update_reference_button() : m.bib_add_reference_button()}</button
		>
	</div>
</form>
