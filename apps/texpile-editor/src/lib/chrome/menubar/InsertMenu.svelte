<script lang="ts">
	import { Menu, Portal } from '@skeletonlabs/skeleton-svelte';
	import { ChevronRight } from '@lucide/svelte';
	import MenuBarTrigger from './MenuBarTrigger.svelte';
	import { contentClass, itemClass, separatorClass } from './menuBarStyles';
	import { cursorInCm } from '$lib/stores/editorStore';
	import type { formatOf } from '$lib/workspace/documentBuffer.svelte';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		index: number;
		select: (value: string) => void;
		mathSelect: (value: string) => void;
		structured: boolean;
		dialect: ReturnType<typeof formatOf>;
		/** an image has to be written next to the document, so no imageDir means nowhere to put it */
		canInsertImage: boolean;
	};

	let { index, select, mathSelect, structured, dialect, canInsertImage }: Props = $props();
</script>

<Menu onSelect={(d) => select(d.value)}>
	<MenuBarTrigger
		id="insert"
		{index}
		label={m.menubar_menu_insert()}
		disabled={!structured || $cursorInCm}
		title={$cursorInCm ? m.menubar_cursor_in_cm_hint() : ''}
	/>
	<Portal>
		<Menu.Positioner>
			<Menu.Content class={contentClass}>
				<Menu onSelect={(d) => mathSelect(d.value)}>
					<Menu.TriggerItem value="math" class={itemClass}>
						<Menu.ItemText>{m.menubar_insert_math_menu()}</Menu.ItemText><ChevronRight class="size-4 opacity-60" />
					</Menu.TriggerItem>
					<Portal>
						<Menu.Positioner>
							<Menu.Content class={contentClass}>
								<Menu.Item value="inline" class={itemClass}><Menu.ItemText>{m.menubar_inline_equation()}</Menu.ItemText></Menu.Item>
								<Menu.Item value="display" class={itemClass}><Menu.ItemText>{m.menubar_display_equation()}</Menu.ItemText></Menu.Item>
								<!-- LaTeX environments; a typst/markdown document has nowhere to put \begin{align} -->
								{#if dialect === 'tex'}
									<Menu.Separator class={separatorClass} />
									<Menu.Item value="align" class={itemClass}><Menu.ItemText>Align</Menu.ItemText></Menu.Item>
									<Menu.Item value="aligned" class={itemClass}><Menu.ItemText>Aligned</Menu.ItemText></Menu.Item>
									<Menu.Item value="gather" class={itemClass}><Menu.ItemText>Gather</Menu.ItemText></Menu.Item>
									<Menu.Item value="cases" class={itemClass}><Menu.ItemText>Cases</Menu.ItemText></Menu.Item>
									<Menu.Item value="multline" class={itemClass}><Menu.ItemText>Multline</Menu.ItemText></Menu.Item>
									<Menu.Item value="split" class={itemClass}><Menu.ItemText>Split</Menu.ItemText></Menu.Item>
									<Menu.Separator class={separatorClass} />
									<Menu.Item value="bmatrix" class={itemClass}><Menu.ItemText>{m.menubar_math_matrix_square()}</Menu.ItemText></Menu.Item>
									<Menu.Item value="pmatrix" class={itemClass}><Menu.ItemText>{m.menubar_math_matrix_paren()}</Menu.ItemText></Menu.Item>
								{/if}
							</Menu.Content>
						</Menu.Positioner>
					</Portal>
				</Menu>
				{#if canInsertImage}
					<Menu.Item value="image" class={itemClass}><Menu.ItemText>{m.menubar_insert_image()}</Menu.ItemText></Menu.Item>
				{/if}
				<Menu.Item value="table" class={itemClass}><Menu.ItemText>{m.menubar_insert_table()}</Menu.ItemText></Menu.Item>
				<!-- markdown has no citation node; tex writes \autocite, typst an @ref chip -->
				{#if dialect !== 'md'}
					<Menu.Item value="citation" class={itemClass}><Menu.ItemText>{m.menubar_insert_citation()}</Menu.ItemText></Menu.Item>
				{/if}
				<Menu.Item value="link" class={itemClass}><Menu.ItemText>{m.menubar_insert_link()}</Menu.ItemText></Menu.Item>
				<Menu.Item value="code" class={itemClass}><Menu.ItemText>{m.menubar_insert_code_block()}</Menu.ItemText></Menu.Item>
				<Menu.Item value="hrule" class={itemClass}><Menu.ItemText>{m.menubar_insert_hrule()}</Menu.ItemText></Menu.Item>
				{#if dialect === 'tex'}
					<Menu.Separator class={separatorClass} />
					<Menu.Item value="environment" class={itemClass}><Menu.ItemText>{m.menubar_insert_environment()}</Menu.ItemText></Menu.Item>
					<Menu.Item value="rawlatex" class={itemClass}><Menu.ItemText>{m.menubar_insert_raw_latex()}</Menu.ItemText></Menu.Item>
					<Menu.Item value="inlinelatex" class={itemClass}><Menu.ItemText>{m.menubar_insert_inline_latex()}</Menu.ItemText></Menu.Item>
				{/if}
			</Menu.Content>
		</Menu.Positioner>
	</Portal>
</Menu>
