<script lang="ts">
	import { ChevronRight, ChevronDown, FilePlus, Pencil, Trash2, Star, FileSymlink } from '@lucide/svelte';
	import { untrack } from 'svelte';
	import FileIcon from './FileIcon.svelte';
	import FileTreeRightClickMenu, { type TreeTarget } from './FileTreeRightClickMenu.svelte';
	import { samePath, type TreeEntry } from '$lib/workspace/fileSystem';
	import type { FileHistory } from '$lib/workspace/fileHistory.svelte';
	import { gitKey } from '$lib/workspace/gitStore';
	import type { GitBadge } from '$lib/workspace/git';
	import { m } from '$lib/paraglide/messages';
	import { confirmAsk } from '$lib/modals/confirm.svelte';
	import { toaster } from '$lib/modals/toaster-svelte';

	type Props = {
		tree: TreeEntry[];
		rootPath: string;
		activePath: string | null;
		/** Absolute path of the project's main entry .tex (badged in the tree), or null. */
		mainPath?: string | null;
		/** Per-file git status badges, keyed by gitKey(path). Empty when not a repo. */
		gitStatus?: Record<string, GitBadge>;
		onOpen: (entry: TreeEntry) => void;
		/** type 'include' creates a fragment (.tex or .typ per the compile target) AND inserts a
		 * reference for it at the cursor. */
		onCreate: (parentDir: string, name: string, type: 'file' | 'dir' | 'include') => void;
		/** the compile target is Typst: the New Include hint speaks #include, not \input */
		typstProject?: boolean;
		onRename: (entry: TreeEntry, newName: string) => void;
		/** several entries at once when a multi-selection is deleted/dragged. */
		onDelete: (entries: TreeEntry[]) => void;
		onMove: (entries: TreeEntry[], targetDir: string) => void;
		/** files dropped from the OS file manager or pasted from the clipboard. */
		onImport?: (items: ImportItem[], targetDir: string) => void;
		/** absolute paths dragged in from ANOTHER Texpile window; the drop copies them here. */
		onCopyIn?: (paths: string[], targetDir: string) => void;
		/** Set (or, if already main, clear) the project's main entry file. */
		onSetMain?: (entry: TreeEntry) => void;
		/** select the entry in the OS file manager. Omitted outside the desktop shell. */
		onReveal?: (entry: TreeEntry) => void;
		/** the tree's own undo/redo stack for FILE operations - never the editor's text history. */
		history?: FileHistory | null;
		/** guest session: browse + open only, no rename/delete/internal-move. */
		/** allow adding new files by drop-from-OS / paste (true even for a read-only guest). */
		allowImport?: boolean;
	};
	let {
		tree,
		rootPath,
		activePath,
		mainPath = null,
		gitStatus = {},
		onOpen,
		onCreate,
		typstProject = false,
		onRename,
		onDelete,
		onMove,
		onImport,
		onCopyIn,
		onSetMain,
		onReveal,
		history = null,
		allowImport = true
	}: Props = $props();

	type ImportItem = {
		/** destination path relative to the drop/paste target dir (forward slashes). */
		relPath: string;
		file: globalThis.File;
	};

	// samePath, not ===: a restored activePath can arrive mixed-separator on Windows and match no row
	const isActive = (e: TreeEntry) => !!activePath && samePath(activePath, e.path);

	// .typ can be a main file too: the typst preview and PDF export both target mainFile ?? open file
	const isMainable = (e: TreeEntry) => e.type === 'file' && /\.(tex|typ)$/i.test(e.name);
	const isMain = (e: TreeEntry) => !!mainPath && e.path.replace(/\\/g, '/').toLowerCase() === mainPath.replace(/\\/g, '/').toLowerCase();

	const gitBadge = (e: TreeEntry): GitBadge | undefined => (e.type === 'file' ? gitStatus[gitKey(e.path)] : undefined);
	const BADGE_COLOR: Record<GitBadge, string> = {
		M: 'text-amber-500',
		A: 'text-green-500',
		D: 'text-red-500',
		U: 'text-sky-500',
		R: 'text-violet-500'
	};
	const BADGE_TITLE: Record<GitBadge, string> = {
		M: m.filetree_badge_modified(),
		A: m.filetree_badge_added(),
		D: m.filetree_badge_deleted(),
		U: m.filetree_badge_untracked(),
		R: m.filetree_badge_renamed()
	};

	let expanded = $state<Record<string, boolean>>({});
	let renaming = $state<string | null>(null);
	let renameValue = $state('');
	let renameEdited = $state(false);
	let creatingIn = $state<string | null>(null);
	let createType = $state<'file' | 'dir' | 'include'>('file');
	let createValue = $state('');
	let createEdited = $state(false); // did the user actually type, or is this still our pre-fill?

	let selected = $state<string[]>([]);

	// keep the selection only when it holds the file being opened; a row click selects and opens at once
	$effect(() => {
		const a = activePath;
		if (!a) return;
		untrack(() => {
			if (!selected.some((p) => samePath(p, a))) selected = [];
		});
	});
	let anchorPath: string | null = null; // shift-range pivot; the last plain/ctrl-clicked row

	/** the tree in on-screen order, honouring which folders are expanded (shift-range domain). */
	function flattenVisible(entries: TreeEntry[] = tree, out: TreeEntry[] = []): TreeEntry[] {
		for (const e of entries) {
			out.push(e);
			if (e.type === 'dir' && expanded[e.path]) flattenVisible(e.children ?? [], out);
		}
		return out;
	}
	function findEntry(path: string, entries: TreeEntry[] = tree): TreeEntry | null {
		for (const e of entries) {
			if (e.path === path) return e;
			if (e.type === 'dir') {
				const hit = findEntry(path, e.children ?? []);
				if (hit) return hit;
			}
		}
		return null;
	}
	/** selected entries with nested ones pruned; a child handled after its parent moved is a dead path */
	function selectedEntries(): TreeEntry[] {
		const paths = selected.filter((p) => !selected.some((other) => other !== p && isInside(p, other)));
		return paths.map((p) => findEntry(p)).filter((e): e is TreeEntry => !!e);
	}
	function handleRowClick(e: MouseEvent, entry: TreeEntry) {
		if (e.ctrlKey || e.metaKey) {
			selected = selected.includes(entry.path) ? selected.filter((p) => p !== entry.path) : [...selected, entry.path];
			anchorPath = entry.path;
			return;
		}
		if (e.shiftKey && anchorPath) {
			const order = flattenVisible().map((x) => x.path);
			const a = order.indexOf(anchorPath);
			const b = order.indexOf(entry.path);
			if (a >= 0 && b >= 0) {
				selected = order.slice(Math.min(a, b), Math.max(a, b) + 1);
				return;
			}
		}
		selected = [entry.path];
		anchorPath = entry.path;
		if (entry.type === 'dir') expanded[entry.path] = !expanded[entry.path];
		else onOpen(entry);
	}

	let dragging = $state<TreeEntry | null>(null);
	let dragPaths = $state<string[]>([]);
	// the DIRECTORY that would receive the drop, or ROOT
	let dropTarget = $state<string | null>(null);
	const ROOT = '__root__';

	const sepOf = (p: string) => (p.includes('\\') ? '\\' : '/');
	const parentOf = (p: string) => {
		const i = p.lastIndexOf(sepOf(p));
		return i >= 0 ? p.slice(0, i) : p;
	};
	const dropDir = (entry: TreeEntry) => (entry.type === 'dir' ? entry.path : parentOf(entry.path));
	const isInside = (path: string, ancestor: string) => path.startsWith(ancestor + sepOf(ancestor));
	const canDropAll = (target: string) => dragPaths.length > 0 && dragPaths.every((p) => target !== p && !isInside(target, p));
	const isExternalDrag = (e: DragEvent) => !dragging && !!e.dataTransfer?.types?.includes('Files');
	// a tag, not the data: drag payloads are sealed until drop, so only the TYPE is readable on dragover
	const PATHS_MIME = 'application/x-texpile-paths';
	const isCrossWindowDrag = (e: DragEvent) => !dragging && !!e.dataTransfer?.types?.includes(PATHS_MIME);
	const markTarget = (dir: string) => {
		dropTarget = dir === rootPath ? ROOT : dir;
	};

	function onRowDragStart(e: DragEvent, entry: TreeEntry) {
		if (!selected.includes(entry.path)) {
			selected = [entry.path];
			anchorPath = entry.path;
		}
		dragging = entry;
		dragPaths = selectedEntries().map((x) => x.path);
		if (e.dataTransfer) {
			// move within this window; a drop in another window's tree copies instead
			e.dataTransfer.effectAllowed = 'copyMove';
			e.dataTransfer.setData('text/plain', dragPaths.join('\n'));
			e.dataTransfer.setData(PATHS_MIME, JSON.stringify(dragPaths));
		}
	}
	function onRowDragOver(e: DragEvent, entry: TreeEntry) {
		const dir = dropDir(entry);
		if (isExternalDrag(e) || isCrossWindowDrag(e)) {
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
			markTarget(dir);
			return;
		}
		if (!canDropAll(dir)) return;
		e.preventDefault();
		e.stopPropagation(); // the container's handler would re-target the drop to ROOT
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		markTarget(dir);
	}
	function onRowDrop(e: DragEvent, entry: TreeEntry) {
		e.preventDefault();
		e.stopPropagation();
		finishDrop(e, dropDir(entry));
	}
	function onRootDragOver(e: DragEvent) {
		if (isExternalDrag(e) || isCrossWindowDrag(e)) {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
			dropTarget = ROOT;
			return;
		}
		if (!canDropAll(rootPath)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		dropTarget = ROOT;
	}
	function onRootDrop(e: DragEvent) {
		e.preventDefault();
		finishDrop(e, rootPath);
	}
	function finishDrop(e: DragEvent, targetDir: string) {
		const external = isExternalDrag(e);
		const crossWindow = isCrossWindowDrag(e);
		const entries = dragging ? selectedEntries() : [];
		const valid = canDropAll(targetDir);
		dragging = null;
		dragPaths = [];
		dropTarget = null;
		if (crossWindow) {
			// copies rather than moves, so the source window's workspace is not mutated behind its back
			let paths: string[] = [];
			try {
				paths = JSON.parse(e.dataTransfer?.getData(PATHS_MIME) || '[]');
			} catch {
				/* malformed payload: ignore the drop */
			}
			const safe = paths.filter((p) => typeof p === 'string' && p && targetDir !== p && !isInside(targetDir, p));
			if (safe.length) onCopyIn?.(safe, targetDir);
		} else if (external) {
			void collectDropItems(e).then((items) => {
				if (items.length) onImport?.(items, targetDir);
			});
		} else if (entries.length && valid) {
			onMove(entries, targetDir);
		}
	}
	// on the container, not per row: moving between rows fires a dragleave that would blank the ring
	function onTreeDragLeave(e: DragEvent) {
		const to = e.relatedTarget as Node | null;
		if (!to || !(e.currentTarget as HTMLElement).contains(to)) dropTarget = null;
	}
	function onDragEnd() {
		dragging = null;
		dragPaths = [];
		dropTarget = null;
	}

	// walks the webkitGetAsEntry tree so a dropped FOLDER imports its contents, and reads bytes
	// rather than OS paths, which is also what makes it work for clipboard files
	async function collectDropItems(e: DragEvent): Promise<ImportItem[]> {
		const out: ImportItem[] = [];
		const items = [...(e.dataTransfer?.items ?? [])];
		const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
		if (!entries.length) {
			for (const f of e.dataTransfer?.files ?? []) out.push({ relPath: f.name, file: f });
			return out;
		}
		const readAll = (dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> =>
			new Promise((resolve) => {
				const reader = dir.createReader();
				const acc: FileSystemEntry[] = [];
				const step = () =>
					reader.readEntries(
						(batch) => {
							if (!batch.length) return resolve(acc);
							acc.push(...batch);
							step(); // readEntries returns at most ~100 per call
						},
						() => resolve(acc)
					);
				step();
			});
		const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
			if (entry.isFile) {
				const f = await new Promise<globalThis.File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)).catch(
					() => null
				);
				if (f) out.push({ relPath: prefix + entry.name, file: f });
			} else if (entry.isDirectory) {
				for (const child of await readAll(entry as FileSystemDirectoryEntry)) await walk(child, prefix + entry.name + '/');
			}
		};
		for (const entry of entries) await walk(entry, '');
		return out;
	}

	function pasteTargetDir(): string {
		const sel = selectedEntries();
		return sel.length === 1 && sel[0].type === 'dir' ? sel[0].path : rootPath;
	}

	// a pasted screenshot arrives as a nameless "image.png"; give it a recognizable name
	function onPaste(e: ClipboardEvent) {
		if (!allowImport || !onImport) return;
		const el = e.target as HTMLElement | null;
		if (el?.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
		const files = [...(e.clipboardData?.files ?? [])];
		if (!files.length) return;
		e.preventDefault();
		const items = files.map((f, i) => {
			let name = f.name || 'pasted-image.png';
			if (/^image\.(png|jpe?g|gif|webp)$/i.test(name)) name = name.replace(/^image/i, 'pasted-image');
			if (files.length > 1 && files.every((x) => x.name === files[0].name)) name = name.replace(/(\.[^.]+)$/, `-${i + 1}$1`);
			return { relPath: name, file: f };
		});
		onImport(items, pasteTargetDir());
	}

	// our own path clipboard: a renderer cannot read file paths back out of the OS one, and putting
	// the bytes there would mean loading every selected file into memory to copy a folder
	let clipboard = $state<string[]>([]);
	const canPaste = $derived(clipboard.length > 0 && !!onCopyIn);

	function copySelection() {
		const paths = selectedEntries().map((e) => e.path);
		if (!paths.length) return;
		clipboard = paths;
		toaster.success({
			title:
				paths.length === 1 ? m.filetree_toast_copied_one({ count: paths.length }) : m.filetree_toast_copied_other({ count: paths.length })
		});
	}

	function pasteClipboard(targetDir = pasteTargetDir()) {
		const safe = clipboard.filter((p) => targetDir !== p && !isInside(targetDir, p));
		if (safe.length) onCopyIn?.(safe, targetDir);
	}

	let treeEl = $state<HTMLElement | null>(null);
	// gates the shortcuts AND the active row's accent, from one source: Ctrl+Z must undo a file here
	// and a document edit in the editor, so the colour and the keystroke can never disagree
	let focused = $state(false);

	// dialogs hand focus back to their own trigger, which would leave the Ctrl+Z after a delete
	// landing on nothing
	const refocusTree = () => queueMicrotask(() => treeEl?.focus({ preventScroll: true }));

	function onTreeKeydown(e: KeyboardEvent) {
		if (!focused || !(e.ctrlKey || e.metaKey) || e.altKey) return;
		const k = e.key.toLowerCase();
		if (k === 'c') {
			e.preventDefault();
			copySelection();
		} else if (k === 'v') {
			// let it through when we have nothing, so the paste EVENT still imports OS-clipboard files
			if (!canPaste) return;
			e.preventDefault();
			pasteClipboard();
		} else if (k === 'z' && !e.shiftKey) {
			e.preventDefault();
			void history?.undo();
		} else if (k === 'y' || (k === 'z' && e.shiftKey)) {
			e.preventDefault();
			void history?.redo();
		}
	}

	let rightClick: { open: (event: MouseEvent, at: TreeTarget) => void; close: () => void; isOpen: () => boolean } | undefined;
	function openCtx(e: MouseEvent, entry: TreeEntry | null) {
		// right-clicking outside the selection retargets it (the menu acts on what's selected)
		if (entry && !selected.includes(entry.path)) {
			selected = [entry.path];
			anchorPath = entry.path;
		}
		rightClick?.open(e, {
			entry,
			createDir: entry?.type === 'dir' ? entry.path : rootPath,
			pasteDir: entry?.type === 'dir' ? entry.path : pasteTargetDir(),
			selectionCount: entry ? deleteCount(entry) : 0,
			isMain: !!entry && isMain(entry),
			canSetMain: !!entry && deleteCount(entry) === 1 && isMainable(entry) && !!onSetMain,
			canPaste,
			canReveal: !!entry && !!onReveal && deleteCount(entry) === 1
		});
	}

	// focus on mount and select the base name (keep the extension, like VSCode).
	function focusSelect(node: HTMLInputElement) {
		const grab = () => {
			node.focus();
			const dot = node.value.lastIndexOf('.');
			if (dot > 0) node.setSelectionRange(0, dot);
			else node.select();
		};
		grab();
		// a closing Skeleton menu (Zag) refocuses its trigger a microtask later and steals the field.
		// grab it back ONCE; a re-assert loop was tried and made the field impossible to leave
		requestAnimationFrame(() => {
			if (node.isConnected && document.activeElement !== node) grab();
		});
	}

	function startCreate(dir: string, type: 'file' | 'dir' | 'include', defaultName = '') {
		creatingIn = dir;
		createType = type;
		createValue = defaultName;
		createEdited = false;
		if (dir !== rootPath) expanded[dir] = true;
	}
	/** begins creating a file/folder/include at the workspace root; defaultName pre-fills the input. */
	export function newAtRoot(type: 'file' | 'dir' | 'include', defaultName = '') {
		startCreate(rootPath, type, defaultName);
	}
	/** true while an inline name input is open, so callers don't rebuild the tree out from under it. */
	export function isEditing() {
		return creatingIn !== null || renaming !== null;
	}
	function commitCreate() {
		const v = createValue.trim();
		const dir = creatingIn;
		creatingIn = null;
		createValue = '';
		if (v && dir) onCreate(dir, v, createType);
	}
	// blur is not consent: an untouched field losing focus means dismiss, not accept the pre-fill.
	// decided a frame late, because the menu/focusSelect handoff above blurs it spuriously first
	function blurCreate(e: FocusEvent) {
		if (createEdited) {
			commitCreate();
			return;
		}
		const input = e.currentTarget as HTMLElement;
		requestAnimationFrame(() => {
			if (creatingIn !== null && document.activeElement !== input) cancelCreate();
		});
	}
	function cancelCreate() {
		creatingIn = null;
		createValue = '';
	}
	function startRename(e: TreeEntry) {
		renaming = e.path;
		renameValue = e.name;
		renameEdited = false;
	}
	function commitRename(e: TreeEntry) {
		if (renaming !== e.path) return; // guard against Enter + blur double-firing
		renaming = null;
		const v = renameValue.trim();
		if (v && v !== e.name) onRename(e, v);
	}
	/** same deferred-dismiss reasoning as blurCreate. */
	function blurRename(e: FocusEvent, entry: TreeEntry) {
		if (renameEdited) {
			commitRename(entry);
			return;
		}
		const input = e.currentTarget as HTMLElement;
		requestAnimationFrame(() => {
			if (renaming === entry.path && document.activeElement !== input) renaming = null;
		});
	}
	async function confirmDelete(e: TreeEntry) {
		// deleting a row inside a multi-selection deletes the whole selection
		if (selected.includes(e.path) && selectedEntries().length > 1) {
			const entries = selectedEntries();
			if (
				await confirmAsk(m.filetree_confirm_delete_many({ count: entries.length }), { confirmLabel: m.filetree_delete(), danger: true })
			) {
				onDelete(entries);
				selected = [];
			}
			refocusTree();
			return;
		}
		const message = e.type === 'dir' ? m.filetree_confirm_delete_dir({ name: e.name }) : m.filetree_confirm_delete_file({ name: e.name });
		if (await confirmAsk(message, { confirmLabel: m.filetree_delete(), danger: true })) onDelete([e]);
		refocusTree();
	}
	const deleteCount = (e: TreeEntry) => (selected.includes(e.path) ? selectedEntries().length : 1);
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key !== 'Escape') {
			onTreeKeydown(e);
			return;
		}
		// escape hatch even if the inline input lost focus
		if (rightClick?.isOpen()) rightClick.close();
		else if (creatingIn !== null) cancelCreate();
		else if (renaming !== null) renaming = null;
		else if (selected.length) selected = [];
	}}
	onpaste={onPaste}
/>

{#snippet createInput(depth: number)}
	<div class="flex items-center gap-1 py-0.5" style="padding-left: {depth * 12 + 6}px">
		<!-- the icon previews what the row will become, so it tracks the name as it is typed -->
		{#if createType === 'dir'}<FileIcon name="" folder="closed" class="size-4 shrink-0" />{:else if createType === 'include'}<FileSymlink
				class="text-surface-400 size-4 shrink-0"
			/>{:else}<FileIcon name={createValue} class="size-4 shrink-0" />{/if}
		<input
			class="input h-6 flex-1 py-0 text-sm"
			placeholder={createType === 'dir'
				? m.filetree_placeholder_folder_name()
				: createType === 'include'
					? m.filetree_placeholder_include_name()
					: m.filetree_placeholder_file_name()}
			value={createValue}
			oninput={(e) => {
				createValue = e.currentTarget.value;
				createEdited = true;
			}}
			use:focusSelect
			draggable="false"
			onpointerdown={(e) => e.stopPropagation()}
			onkeydown={(e) => {
				if (e.key === 'Enter') commitCreate();
				else if (e.key === 'Escape') cancelCreate();
			}}
			onblur={blurCreate}
		/>
	</div>
{/snippet}

{#snippet row(entry: TreeEntry, depth: number)}
	<div>
		<!-- accent TEXT only while the tree has focus: it promises Ctrl+Z acts on files, not the document -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="group flex items-center rounded text-sm transition-colors {isActive(entry)
				? `bg-primary-500/15 font-medium ${focused ? 'text-primary-700 dark:text-primary-300' : ''}`
				: selected.includes(entry.path)
					? 'bg-surface-300-700/60'
					: 'hover:bg-surface-200-800'} {dropTarget === entry.path && entry.type === 'dir'
				? 'ring-primary-500 ring-2 ring-inset'
				: ''} {dragPaths.includes(entry.path) ? 'opacity-50' : ''}"
			draggable={renaming !== entry.path}
			ondragstart={(e) => onRowDragStart(e, entry)}
			ondragover={(e) => onRowDragOver(e, entry)}
			ondrop={(e) => onRowDrop(e, entry)}
			ondragend={onDragEnd}
			oncontextmenu={(e) => openCtx(e, entry)}
		>
			<button
				class="flex min-w-0 flex-1 items-center gap-1 py-0.5"
				style="padding-left: {depth * 12 + 4}px"
				onclick={(e) => handleRowClick(e, entry)}
				ondblclick={() => entry.type === 'file' && onOpen(entry)}
			>
				{#if entry.type === 'dir'}
					{#if expanded[entry.path]}<ChevronDown class="text-surface-400 size-3.5 shrink-0" />{:else}<ChevronRight
							class="text-surface-400 size-3.5 shrink-0"
						/>{/if}
					<FileIcon name={entry.name} folder={expanded[entry.path] ? 'open' : 'closed'} class="size-4 shrink-0" />
				{:else}
					<span class="w-3.5 shrink-0"></span>
					<FileIcon name={entry.name} class="size-4 shrink-0" />
				{/if}
				{#if renaming === entry.path}
					<input
						class="input h-6 min-w-0 flex-1 py-0 text-sm"
						value={renameValue}
						oninput={(e) => {
							renameValue = e.currentTarget.value;
							renameEdited = true;
						}}
						use:focusSelect
						draggable="false"
						onpointerdown={(e) => e.stopPropagation()}
						onclick={(e) => e.stopPropagation()}
						onkeydown={(e) => {
							if (e.key === 'Enter') commitRename(entry);
							else if (e.key === 'Escape') renaming = null;
						}}
						onblur={(e) => blurRename(e, entry)}
					/>
				{:else}
					<span class="truncate">{entry.name}</span>
					{#if isMain(entry)}
						<Star class="fill-primary-500 text-primary-500 size-3 shrink-0" aria-label={m.filetree_main_file_label()} />
					{/if}
					{#if gitBadge(entry)}
						{@const b = gitBadge(entry)}
						<!-- pushed left by the hover buttons rather than faded out, which read as a flicker -->
						<span class="ml-auto shrink-0 pr-1 font-mono text-xs font-bold {b ? BADGE_COLOR[b] : ''}" title={b ? BADGE_TITLE[b] : ''}
							>{b}</span
						>
					{/if}
				{/if}
			</button>
			{#if renaming !== entry.path}
				<!-- `hidden`, not opacity-0: laid out permanently it reserved width on every row and held
				     the git badge in off the right edge -->
				<div class="hidden shrink-0 items-center gap-0.5 pr-1 group-hover:flex">
					{#if entry.type === 'dir'}
						<button
							class="btn-icon btn-icon-xs hover:preset-tonal"
							title={m.filetree_new_file_title()}
							onclick={() => startCreate(entry.path, 'file')}
						>
							<FilePlus class="size-3.5" />
						</button>
					{/if}
					<button class="btn-icon btn-icon-xs hover:preset-tonal" title={m.filetree_rename()} onclick={() => startRename(entry)}>
						<Pencil class="size-3.5" />
					</button>
					<button class="btn-icon btn-icon-xs hover:preset-tonal-error" title={m.filetree_delete()} onclick={() => confirmDelete(entry)}>
						<Trash2 class="size-3.5" />
					</button>
				</div>
			{/if}
		</div>

		{#if entry.type === 'dir' && expanded[entry.path]}
			{#if creatingIn === entry.path}{@render createInput(depth + 1)}{/if}
			{#each entry.children ?? [] as child (child.path)}
				{@render row(child, depth + 1)}
			{/each}
		{/if}
	</div>
{/snippet}

<!-- empty space targets the workspace root -->
<div
	bind:this={treeEl}
	role="presentation"
	tabindex="-1"
	class="min-h-full rounded outline-none {dropTarget === ROOT ? 'ring-primary-500 ring-2 ring-inset' : ''}"
	onfocusin={() => (focused = true)}
	onfocusout={(e) => {
		// relatedTarget is where focus is HEADING; moving between two rows must not read as leaving
		if (!treeEl?.contains(e.relatedTarget as Node | null)) focused = false;
	}}
	ondragover={onRootDragOver}
	ondragleave={onTreeDragLeave}
	ondrop={onRootDrop}
	onclick={(e) => {
		if (e.target === e.currentTarget) selected = [];
	}}
	oncontextmenu={(e) => openCtx(e, null)}
>
	{#if creatingIn === rootPath}{@render createInput(0)}{/if}
	{#each tree as entry (entry.path)}
		{@render row(entry, 0)}
	{/each}
</div>

<FileTreeRightClickMenu
	bind:this={rightClick}
	{history}
	{typstProject}
	{onSetMain}
	{onReveal}
	onCreate={startCreate}
	onCopy={copySelection}
	onPaste={pasteClipboard}
	onRename={startRename}
	onDelete={confirmDelete}
	onClose={refocusTree}
/>
