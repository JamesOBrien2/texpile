<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronRight, ChevronDown, FilePlus, Pencil, Trash2, Star } from '@lucide/svelte';
	import FileIcon from './FileIcon.svelte';
	import FileTreeRow from './FileTreeRow.svelte';
	import type { TreeEntry } from '$lib/workspace/fileSystem';
	import type { GitBadge } from '$lib/workspace/git';
	import type { FileTreeState } from './treeState.svelte';
	import type { FileTreeDnd } from './treeDnd.svelte';
	import type { TreeNameEditor } from './treeNameEditor.svelte';
	import { gitBadgeOf, BADGE_COLOR, BADGE_TITLE } from './treeBadges';
	import { focusSelect } from './focusSelect';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		entry: TreeEntry;
		depth: number;
		sel: FileTreeState;
		dnd: FileTreeDnd;
		editor: TreeNameEditor;
		/** the tree owns keyboard focus, so the accent promises Ctrl+Z acts on files */
		focused: boolean;
		gitStatus: Record<string, GitBadge>;
		isActive: (e: TreeEntry) => boolean;
		isMain: (e: TreeEntry) => boolean;
		onOpen: (entry: TreeEntry) => void;
		openCtx: (e: MouseEvent, entry: TreeEntry) => void;
		confirmDelete: (e: TreeEntry) => void;
		createInput: Snippet<[number]>;
	};

	let { entry, depth, sel, dnd, editor, focused, gitStatus, isActive, isMain, onOpen, openCtx, confirmDelete, createInput }: Props =
		$props();
</script>

<div>
	<!-- accent TEXT only while the tree has focus: it promises Ctrl+Z acts on files, not the document -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="group flex items-center rounded text-sm transition-colors {isActive(entry)
			? `bg-primary-500/15 font-medium ${focused ? 'text-primary-700 dark:text-primary-300' : ''}`
			: sel.selected.includes(entry.path)
				? 'bg-surface-300-700/60'
				: 'hover:bg-surface-200-800'} {dnd.dropTarget === entry.path && entry.type === 'dir'
			? 'ring-primary-500 ring-2 ring-inset'
			: ''} {dnd.dragPaths.includes(entry.path) ? 'opacity-50' : ''}"
		draggable={editor.renaming !== entry.path}
		ondragstart={(e) => dnd.onRowDragStart(e, entry)}
		ondragover={(e) => dnd.onRowDragOver(e, entry)}
		ondrop={(e) => dnd.onRowDrop(e, entry)}
		ondragend={() => dnd.onDragEnd()}
		oncontextmenu={(e) => openCtx(e, entry)}
	>
		<button
			class="flex min-w-0 flex-1 items-center gap-1 py-0.5"
			style="padding-left: {depth * 12 + 4}px"
			onclick={(e) => sel.handleRowClick(e, entry)}
			ondblclick={() => entry.type === 'file' && onOpen(entry)}
		>
			{#if entry.type === 'dir'}
				{#if sel.expanded[entry.path]}<ChevronDown class="text-surface-400 size-3.5 shrink-0" />{:else}<ChevronRight
						class="text-surface-400 size-3.5 shrink-0"
					/>{/if}
				<FileIcon name={entry.name} folder={sel.expanded[entry.path] ? 'open' : 'closed'} class="size-4 shrink-0" />
			{:else}
				<span class="w-3.5 shrink-0"></span>
				<FileIcon name={entry.name} class="size-4 shrink-0" />
			{/if}
			{#if editor.renaming === entry.path}
				<input
					class="input h-6 min-w-0 flex-1 py-0 text-sm"
					value={editor.renameValue}
					oninput={(e) => {
						editor.renameValue = e.currentTarget.value;
						editor.renameEdited = true;
					}}
					use:focusSelect
					draggable="false"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => e.stopPropagation()}
					onkeydown={(e) => {
						if (e.key === 'Enter') editor.commitRename(entry);
						else if (e.key === 'Escape') editor.renaming = null;
					}}
					onblur={(e) => editor.blurRename(e, entry)}
				/>
			{:else}
				<span class="truncate">{entry.name}</span>
				{#if isMain(entry)}
					<Star class="fill-primary-500 text-primary-500 size-3 shrink-0" aria-label={m.filetree_main_file_label()} />
				{/if}
				{#if gitBadgeOf(gitStatus, entry)}
					{@const b = gitBadgeOf(gitStatus, entry)}
					<!-- pushed left by the hover buttons rather than faded out, which read as a flicker -->
					<span class="ml-auto shrink-0 pr-1 font-mono text-xs font-bold {b ? BADGE_COLOR[b] : ''}" title={b ? BADGE_TITLE[b] : ''}
						>{b}</span
					>
				{/if}
			{/if}
		</button>
		{#if editor.renaming !== entry.path}
			<!-- `hidden`, not opacity-0: laid out permanently it reserved width on every row and held
			     the git badge in off the right edge -->
			<div class="hidden shrink-0 items-center gap-0.5 pr-1 group-hover:flex">
				{#if entry.type === 'dir'}
					<button
						class="btn-icon btn-icon-xs hover:preset-tonal"
						title={m.filetree_new_file_title()}
						onclick={() => editor.startCreate(entry.path, 'file')}
					>
						<FilePlus class="size-3.5" />
					</button>
				{/if}
				<button class="btn-icon btn-icon-xs hover:preset-tonal" title={m.filetree_rename()} onclick={() => editor.startRename(entry)}>
					<Pencil class="size-3.5" />
				</button>
				<button class="btn-icon btn-icon-xs hover:preset-tonal-error" title={m.filetree_delete()} onclick={() => confirmDelete(entry)}>
					<Trash2 class="size-3.5" />
				</button>
			</div>
		{/if}
	</div>

	{#if entry.type === 'dir' && sel.expanded[entry.path]}
		{#if editor.creatingIn === entry.path}{@render createInput(depth + 1)}{/if}
		{#each entry.children ?? [] as child (child.path)}
			<FileTreeRow
				entry={child}
				depth={depth + 1}
				{sel}
				{dnd}
				{editor}
				{focused}
				{gitStatus}
				{isActive}
				{isMain}
				{onOpen}
				{openCtx}
				{confirmDelete}
				{createInput}
			/>
		{/each}
	{/if}
</div>
