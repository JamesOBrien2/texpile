<script lang="ts">
	import { Menu, Portal } from '@skeletonlabs/skeleton-svelte';
	import MenuBarTrigger from './MenuBarTrigger.svelte';
	import { contentClass, itemClass, separatorClass } from './menuBarStyles';
	import { cursorInCm } from '$lib/stores/editorStore';
	import type { FileKind, formatOf } from '$lib/workspace/documentBuffer.svelte';
	import { combo } from '$lib/chrome/shortcutText';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		index: number;
		select: (value: string) => void;
		structured: boolean;
		dialect: ReturnType<typeof formatOf>;
		fileKind: FileKind;
		canFormatDocument: boolean;
	};

	let { index, select, structured, dialect, fileKind, canFormatDocument }: Props = $props();
</script>

<Menu onSelect={(d) => select(d.value)}>
	<MenuBarTrigger
		id="format"
		{index}
		label={m.menubar_menu_format()}
		disabled={!structured || $cursorInCm}
		title={$cursorInCm ? m.menubar_cursor_in_cm_hint() : ''}
	/>
	<Portal>
		<Menu.Positioner>
			<Menu.Content class={contentClass}>
				<Menu.Item value="bold" class={itemClass}
					><Menu.ItemText>{m.menubar_format_bold()}</Menu.ItemText><span class="opacity-50">{combo('B')}</span></Menu.Item
				>
				<Menu.Item value="italic" class={itemClass}
					><Menu.ItemText>{m.menubar_format_italic()}</Menu.ItemText><span class="opacity-50">{combo('I')}</span></Menu.Item
				>
				<!-- markdown has no underline mark and no underline syntax -->
				{#if dialect !== 'md'}
					<Menu.Item value="underline" class={itemClass}
						><Menu.ItemText>{m.menubar_format_underline()}</Menu.ItemText><span class="opacity-50">{combo('U')}</span></Menu.Item
					>
				{/if}
				<Menu.Item value="code" class={itemClass}><Menu.ItemText>{m.menubar_format_inline_code()}</Menu.ItemText></Menu.Item>
				<Menu.Separator class={separatorClass} />
				<Menu.Item value="h1" class={itemClass}><Menu.ItemText>{m.menubar_heading_1()}</Menu.ItemText></Menu.Item>
				<Menu.Item value="h2" class={itemClass}><Menu.ItemText>{m.menubar_heading_2()}</Menu.ItemText></Menu.Item>
				<Menu.Item value="h3" class={itemClass}><Menu.ItemText>{m.menubar_heading_3()}</Menu.ItemText></Menu.Item>
				<Menu.Item value="quote" class={itemClass}><Menu.ItemText>{m.menubar_format_blockquote()}</Menu.ItemText></Menu.Item>
				{#if canFormatDocument}
					<Menu.Separator class={separatorClass} />
					<Menu.Item value="format-document" class={itemClass}
						><Menu.ItemText>{m.menubar_format_document({ tool: fileKind === 'typ' ? 'typstyle' : 'latexindent' })}</Menu.ItemText
						></Menu.Item
					>
				{/if}
			</Menu.Content>
		</Menu.Positioner>
	</Portal>
</Menu>
