<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Menu, Portal } from '@skeletonlabs/skeleton-svelte';
	// Menu is Skeleton's here, so lucide's hamburger comes in aliased
	import { Check, ChevronRight, X, Menu as MenuIcon, MoreHorizontal } from '@lucide/svelte';
	import { get } from 'svelte/store';
	import { editorViewStore, referenceStore, editorConfigStore, cursorInCm } from '$lib/stores/editorStore';
	import { recentFolders } from '$lib/workspace/workspaceStore';
	import { basename, isDesktop, openNewWindow, openFolderInNewWindow } from '$lib/workspace/fileSystem';
	import { isMac } from '$lib/platform';
	import { setSpellcheckEnabled } from '$lib/editor/extensions/spellcheck/spellcheckConfig';
	import SpellcheckDictionary from './SpellcheckDictionary.svelte';
	import PreferencesDialog from './PreferencesDialog.svelte';
	const appVersion = __APP_VERSION__; // injected by Vite from package.json
	import { toggleMark } from 'prosemirror-commands';
	import { schema } from '$lib/schema/schema';
	import { createMathField } from '$lib/editor/extensions/mathlivebridge/mlcommands';
	import { computeMathAttrs } from '$lib/editor/extensions/mathlivebridge/mlview.svelte';
	import { createCodeBlock } from '$lib/editor/extensions/codemirrorbridge/cmcommands';
	import { createTableNode } from '$lib/editor/utils/tableUtils';
	import { startImageUpload } from '$lib/editor/extensions/image';
	import { createLocalImageSettings } from '$lib/editor/extensions/image/imageplugin.svelte';
	import { run, insertNode, activeCm, cmReplace, editSelect, formatSelect } from './menuBarCommands';
	import { checkForUpdate, updateModalOpen, updateState } from '$lib/updates';
	import { whatsNewOpen, hasUnseenWhatsNew } from '$lib/whatsNew';
	import { preferencesOpen } from '$lib/stores/dialogStore';
	import { commandPalette } from '$lib/workspace/commandPalette.svelte';
	import { attachNativeMenu, publishMenuState } from '$lib/workspace/nativeMenu';
	import { titleBarLayout } from '$lib/editor/comp/chrome/titleBarLayout.svelte';
	import { toaster } from '$lib/modals/toaster-svelte';
	import Kbd from '$lib/components/Kbd.svelte';
	import type { Node as PMNode } from 'prosemirror-model';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		disabled?: boolean;
		imageDir?: string;
		/** Create a new file. `ext` (tex/bib/cls/sty) seeds the name + content; omitted = a plain new file. */
		onNewFile?: (ext?: string) => void;
		onOpenFolder?: (path?: string) => void;
		/** Close the current folder and return to the Start screen. */
		onCloseWorkspace?: () => void;
		onSave?: () => void;
		/** shared-session dialog (desktop only). */
		onShareSession?: () => void;
		/** Terminal menu (shown only in the desktop app). */
		terminalAvailable?: boolean;
		terminalVisible?: boolean;
		onCompile?: () => void;
		onConfigureCompile?: () => void;
		onNewTerminal?: () => void;
		onToggleTerminal?: () => void;
		/** Reindent the current document via latexindent (opens the confirm-first modal). */
		onFormatDocument?: () => void;
		/** Open the bundled Texpile Tutorial project (switches the workspace to it). */
		onOpenTutorial?: () => void;
		/** whole-window zoom, shown as a percentage in the View menu. */
		uiZoomPercent?: number;
		onZoomIn?: () => void;
		onZoomOut?: () => void;
		onZoomReset?: () => void;
	}
	let {
		disabled = false,
		imageDir,
		onNewFile,
		onOpenFolder,
		onCloseWorkspace,
		onSave,
		onShareSession,
		terminalAvailable = false,
		terminalVisible = false,
		onCompile,
		onConfigureCompile,
		onNewTerminal,
		onToggleTerminal,
		onFormatDocument,
		onOpenTutorial,
		uiZoomPercent = 100,
		onZoomIn,
		onZoomOut,
		onZoomReset
	}: Props = $props();

	/**
	 * Progressive overflow. The menus render inline left to right for as long as they fit, and the
	 * rest move into a trailing overflow button - `File Edit View ...` - rather than the whole bar
	 * collapsing at once. Help goes first because it is last and least used; zero visible is the
	 * degenerate case and looks like the hamburger it used to be.
	 *
	 * TitleBar decides how many fit: it is the only place that can measure the row, the menus and the
	 * window controls together, and the budget comes from keeping the command center centred.
	 */
	// file edit view insert format spelling [terminal] help. The count has to follow terminalAvailable
	// rather than being a constant 8: the fit loop advances one step per resize, so a menu that renders
	// nothing would be a step that frees no width, produce no resize, and stall the loop one short.
	const menuCount = $derived(terminalAvailable ? 8 : 7);
	const helpIndex = $derived(terminalAvailable ? 7 : 6);
	$effect(() => {
		const n = menuCount;
		untrack(() => titleBarLayout.setTotal(n)); // setTotal writes what it reads; see TitleBar's fit()
	});
	const visible = $derived(titleBarLayout.visibleMenus);
	const overflowing = $derived(visible < menuCount);
	/** does menu `i` belong to the pass currently rendering? */
	const showAt = (i: number, overflow: boolean) => (overflow ? i >= visible : i < visible);

	function viewSelect(value: string) {
		if (value === 'zoom-in') onZoomIn?.();
		else if (value === 'zoom-out') onZoomOut?.();
		else if (value === 'zoom-reset') onZoomReset?.();
	}

	let imageInput: HTMLInputElement;
	function pickImage() {
		if (imageDir) imageInput?.click();
	}
	function onImagePicked(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		const v = $editorViewStore;
		if (!file || !imageDir || !v) return;
		startImageUpload(v, file, m.menubar_image_alt_default(), createLocalImageSettings(imageDir), schema);
		v.focus();
	}

	// Electron has no window.prompt(), so a small custom modal
	let promptOpen = $state(false);
	let promptTitle = $state('');
	let promptValue = $state('');
	let promptResolve: ((v: string | null) => void) | null = null;
	let promptInput = $state<HTMLInputElement>();
	function askText(title: string, initial = ''): Promise<string | null> {
		promptTitle = title;
		promptValue = initial;
		promptOpen = true;
		setTimeout(() => promptInput?.select(), 0);
		return new Promise((resolve) => (promptResolve = resolve));
	}
	function closePrompt(ok: boolean) {
		promptOpen = false;
		promptResolve?.(ok ? promptValue : null);
		promptResolve = null;
	}

	const SUPPORT_EMAIL = 'support@texpile.com';
	let shortcutsOpen = $state(false);
	let supportOpen = $state(false);
	let copied = $state(false);
	function helpSelect(value: string) {
		if (value === 'shortcuts') shortcutsOpen = true;
		else if (value === 'whatsnew') whatsNewOpen.set(true);
		else if (value === 'discord') window.open('https://discord.gg/7wanVzCBWf', '_blank', 'noopener,noreferrer');
		else if (value === 'support') {
			copied = false;
			supportOpen = true;
		} else if (value === 'updates') void checkUpdates();
	}

	async function checkUpdates() {
		// a check while a download is in flight would reset the state; just reopen the modal
		const phase = get(updateState).phase;
		if (phase === 'downloading' || phase === 'downloaded') {
			updateModalOpen.set(true);
			return;
		}
		const status = await checkForUpdate(true);
		if (status === 'update') updateModalOpen.set(true);
		else if (status === 'none')
			toaster.info({
				title: m.menubar_update_none_title(),
				description: m.menubar_update_none_description({ version: appVersion })
			});
		else if (status === 'error')
			toaster.error({ title: m.menubar_update_error_title(), description: m.menubar_update_error_description() });
		else toaster.info({ title: m.menubar_update_unavailable_title() });
	}
	async function copyEmail() {
		try {
			await navigator.clipboard.writeText(SUPPORT_EMAIL);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard unavailable */
		}
	}

	// platform-aware shortcut labels: Ctrl/Shift/Alt on win/linux, ⌘/⇧/⌥ on mac
	function combo(mods: { shift?: boolean; alt?: boolean }, key: string): string {
		if (isMac) return `${mods.alt ? '⌥' : ''}${mods.shift ? '⇧' : ''}⌘${key}`;
		const parts = ['Ctrl'];
		if (mods.shift) parts.push('Shift');
		if (mods.alt) parts.push('Alt');
		parts.push(key);
		return parts.join('+');
	}
	const SHORTCUTS: { group: string; items: { keys: string; label: string }[] }[] = [
		{
			group: m.menubar_shortcut_group_general(),
			items: [
				{ keys: combo({}, 'K'), label: m.palette_open() },
				{ keys: combo({ shift: true }, 'N'), label: m.menubar_new_window() },
				{ keys: combo({}, 'S'), label: m.menubar_save() },
				{ keys: combo({}, 'F'), label: m.menubar_shortcut_find_in_document() },
				{ keys: combo({ shift: true }, 'F'), label: m.menubar_shortcut_find_in_files() },
				{ keys: combo({}, 'Z'), label: m.menubar_undo() },
				{ keys: combo({ shift: true }, 'Z'), label: m.menubar_redo() }
			]
		},
		{
			group: m.menubar_shortcut_group_view(),
			items: [
				{ keys: isMac ? '⌘ +' : 'Ctrl +', label: m.menubar_shortcut_zoom_in_interface() },
				{ keys: isMac ? '⌘ −' : 'Ctrl −', label: m.menubar_shortcut_zoom_out_interface() },
				{ keys: isMac ? '⌘ 0' : 'Ctrl 0', label: m.menubar_shortcut_reset_interface_zoom() }
			]
		},
		{
			group: m.menubar_shortcut_group_compile(),
			items: [{ keys: combo({ alt: true }, 'Enter'), label: m.menubar_shortcut_compile_toggle() }]
		},
		{
			group: m.menubar_shortcut_group_source_editor(),
			items: [
				{ keys: isMac ? 'F12 / ⌘ Click' : 'F12 / Ctrl+Click', label: m.menubar_shortcut_go_to_definition() },
				{ keys: isMac ? '⌃Space' : 'Ctrl+Space', label: m.menubar_shortcut_open_suggestions() },
				{ keys: 'Esc', label: m.menubar_shortcut_hide_math_preview() }
			]
		},
		{
			group: m.menubar_shortcut_group_formatting(),
			items: [
				{ keys: combo({}, 'B'), label: m.menubar_format_bold() },
				{ keys: combo({}, 'I'), label: m.menubar_format_italic() },
				{ keys: combo({}, 'U'), label: m.menubar_format_underline() },
				{ keys: combo({}, '`'), label: m.menubar_format_inline_code() },
				{ keys: combo({}, '.'), label: m.menubar_shortcut_superscript() },
				{ keys: combo({}, ','), label: m.menubar_shortcut_subscript() },
				{ keys: combo({ shift: true }, 'B'), label: m.menubar_format_blockquote() },
				{ keys: combo({ shift: true }, '`'), label: m.menubar_insert_code_block() },
				{
					keys: isMac
						? `${combo({ alt: true }, '1')} … ${combo({ alt: true }, '3')}`
						: `${combo({ shift: true }, '1')} … ${combo({ shift: true }, '3')}`,
					label: m.menubar_shortcut_heading_range()
				}
			]
		},
		{
			group: m.menubar_shortcut_group_math(),
			items: [
				{ keys: combo({}, 'M'), label: m.menubar_shortcut_inline_math() },
				{ keys: combo({ shift: true }, 'M'), label: m.menubar_shortcut_display_math() }
			]
		}
	];

	function fileSelect(value: string) {
		if (value === 'save') onSave?.();
		else if (value === 'new-window') openNewWindow();
		else if (value === 'open-folder-new-window') openFolderInNewWindow();
		else if (value === 'share-session') onShareSession?.();
		else if (value === 'close-workspace') onCloseWorkspace?.();
		else if (value === 'preferences') preferencesOpen.set(true);
	}
	function newFileSelect(ext: string) {
		onNewFile?.(ext);
	}

	// "newfolder" opens the native picker; any other value is a recent folder path
	function openFolderSelect(value: string) {
		if (value === 'newfolder') onOpenFolder?.();
		else onOpenFolder?.(value);
	}

	// display-math templates; block_math detects the environment from content (computeMathAttrs)
	const MATH_ENVS: Record<string, string> = {
		align: '\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}',
		aligned: '\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}',
		gather: '\\begin{gather}\na + b \\\\\nc + d\n\\end{gather}',
		cases: 'f(x) = \\begin{cases}\nx & \\text{if } x \\geq 0 \\\\\n-x & \\text{otherwise}\n\\end{cases}',
		multline: '\\begin{multline}\na + b + c \\\\\n+ d + e + f\n\\end{multline}',
		split: '\\begin{split}\na &= b \\\\\n&= c\n\\end{split}',
		bmatrix: '\\begin{bmatrix}\na & b \\\\\nc & d\n\\end{bmatrix}',
		pmatrix: '\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}'
	};
	function insertMathEnvironment(latex: string) {
		const v = $editorViewStore;
		if (!v) return;
		const node = v.state.schema.nodes.block_math.create(computeMathAttrs(latex), v.state.schema.text(latex));
		v.dispatch(v.state.tr.replaceSelectionWith(node));
		v.focus();
	}
	function mathSelect(value: string) {
		const cm = activeCm();
		if (cm) {
			if (value === 'inline') cmReplace(cm, '$', '$');
			else if (value === 'display') cmReplace(cm, '\\[\n', '\n\\]');
			else if (MATH_ENVS[value]) cmReplace(cm, MATH_ENVS[value]);
			return;
		}
		if (value === 'inline') run(createMathField());
		else if (value === 'display') run(createMathField(true));
		else if (MATH_ENVS[value]) insertMathEnvironment(MATH_ENVS[value]);
	}

	async function insertSelect(value: string) {
		const cm = activeCm();
		if (cm) {
			switch (value) {
				case 'code':
					cmReplace(cm, '\\begin{verbatim}\n', '\n\\end{verbatim}');
					break;
				case 'table':
					cmReplace(cm, '\\begin{tabular}{ccc}\n  a & b & c \\\\\n  d & e & f \\\\\n\\end{tabular}');
					break;
				case 'image':
					cmReplace(cm, '\\includegraphics{', '}');
					break;
				case 'hrule':
					cmReplace(cm, '\\rule{\\linewidth}{0.4pt}');
					break;
				case 'link': {
					const href = await askText(m.menubar_prompt_link_url(), 'https://');
					if (href) cmReplace(cm, `\\href{${href}}{`, '}');
					break;
				}
				case 'citation': {
					const key = get(referenceStore)?.[0]?.key ?? 'key';
					cmReplace(cm, `\\autocite{${key}}`);
					break;
				}
				case 'environment': {
					const name = (await askText(m.menubar_prompt_environment_name(), 'center'))?.trim();
					if (name) cmReplace(cm, `\\begin{${name}}\n`, `\n\\end{${name}}`);
					break;
				}
				// rawlatex / inlinelatex are PM-only nodes; in CM you're already writing LaTeX
			}
			return;
		}
		switch (value) {
			case 'code':
				run(createCodeBlock());
				break;
			case 'table':
				insertNode((state) => createTableNode(state.schema, 3, 3) as unknown as PMNode);
				break;
			case 'image':
				pickImage();
				break;
			case 'rawlatex':
				insertNode((state) => state.schema.nodes.raw_latex.create(null, state.schema.text('\\textbf{LaTeX}')));
				break;
			case 'inlinelatex':
				insertNode((state) => state.schema.nodes.inline_latex.create(null, state.schema.text('\\LaTeX')));
				break;
			case 'hrule':
				insertNode((state) => state.schema.nodes.horizontal_rule.create());
				break;
			case 'link': {
				const href = await askText(m.menubar_prompt_link_url(), 'https://');
				if (href) run(toggleMark(schema.marks.link, { href, title: null }));
				break;
			}
			case 'citation': {
				const key = get(referenceStore)?.[0]?.key ?? 'key';
				insertNode((state) => state.schema.nodes.citation.create({ variant: 'autocite' }, state.schema.text(key)));
				break;
			}
			case 'environment': {
				const name = await askText(m.menubar_prompt_environment_name(), 'center');
				if (name?.trim())
					insertNode((state) => state.schema.nodes.environment.create({ name: name.trim() }, state.schema.nodes.paragraph.create()));
				break;
			}
		}
	}

	const spellcheckOn = $derived($editorConfigStore?.spellcheck ?? false);
	let dictionaryOpen = $state(false);
	function spellcheckSelect(value: string) {
		if (value === 'toggle') setSpellcheckEnabled(!spellcheckOn);
		else if (value === 'dictionary') dictionaryOpen = true;
	}

	function terminalSelect(value: string) {
		switch (value) {
			case 'compile':
				onCompile?.();
				break;
			case 'configure':
				onConfigureCompile?.();
				break;
			case 'new':
				onNewTerminal?.();
				break;
			case 'toggle':
				onToggleTerminal?.();
				break;
		}
	}

	// On macOS the menus are drawn by the system menu bar, and a native selection arrives here as the
	// same `menu:value` string a trigger would have produced - so both paths run one dispatcher.
	const nativeMenus = isMac && isDesktop();
	onMount(() =>
		attachNativeMenu({
			file: fileSelect,
			newFile: newFileSelect,
			openFolder: openFolderSelect,
			edit: (v) => (v === 'palette' ? commandPalette.show() : editSelect(v)),
			view: viewSelect,
			insert: (v) => void insertSelect(v),
			math: mathSelect,
			format: (v) => (v === 'format-document' ? onFormatDocument?.() : formatSelect(v)),
			spelling: spellcheckSelect,
			terminal: terminalSelect,
			help: (v) => (v === 'tutorial' ? onOpenTutorial?.() : helpSelect(v))
		})
	);
	// what the native bar needs to know about this window; re-sent whenever any of it changes
	$effect(() =>
		publishMenuState({
			disabled,
			cursorInCm: $cursorInCm,
			spellcheck: spellcheckOn,
			terminalAvailable,
			terminalVisible,
			canShare: !!onShareSession,
			canCloseWorkspace: !!onCloseWorkspace,
			canFormat: !!onFormatDocument,
			canTutorial: !!onOpenTutorial,
			recentFolders: $recentFolders
		})
	);

	const triggerClass = 'rounded-base px-2.5 py-1 text-sm hover:preset-tonal data-[disabled]:opacity-40';
	const contentClass = 'card bg-surface-50-950 border-surface-200-800 z-[1200] flex min-w-48 flex-col gap-0 border p-1 shadow-xl';
	const itemClass =
		'flex cursor-pointer items-center justify-between gap-6 rounded-base px-2.5 py-1 text-sm hover:preset-tonal data-[disabled]:opacity-40';
</script>

<!-- Lives inside TitleBar's row, so the row owns the border and the height; this only lays out its
     own triggers. no-drag because the row around it is a drag region.
     On macOS the triggers are gone and the real menu bar carries them (window-chrome.ts), but the
     component still mounts: it owns Preferences, the dictionary, the shortcut sheet and the image
     picker, none of which have anything to do with where the menus are drawn.
     preventDefault on mousedown so opening a menu doesn't blur the editor; inserts land at the cursor -->
{#if !nativeMenus}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- no left padding: the app icon before it already provides the gap, and doubling up pushed File
	     away from the mark. The triggers carry their own px-2.5 for their hover targets. -->
	<nav class="app-no-drag flex items-center gap-0.5 pr-1" data-keep-caret onmousedown={(e) => e.preventDefault()}>
		{#if !nativeMenus}
			{@render topMenus(false)}
			{#if overflowing}
				<!-- the leftovers, as submenus. A hamburger when it holds everything, an ellipsis when it
				     is genuinely an overflow of a bar that still shows some menus. -->
				<Menu>
					<Menu.Trigger class={triggerClass} aria-label={m.menubar_all_menus()} title={m.menubar_all_menus()}>
						{#if visible === 0}<MenuIcon class="size-4" />{:else}<MoreHorizontal class="size-4" />{/if}
					</Menu.Trigger>
					<Portal>
						<Menu.Positioner>
							<Menu.Content class={contentClass}>
								{@render topMenus(true)}
							</Menu.Content>
						</Menu.Positioner>
					</Portal>
				</Menu>
			{/if}
		{/if}
	</nav>
{/if}

<!--
	The eight top-level menus, once. Rendered straight into the row normally, or into a single
	dropdown when the window is too narrow for them (VS Code's compact menu bar).

	Only the TRIGGER differs between the two layouts - Menu.Trigger as a button in the row, or
	Menu.TriggerItem as a row in the parent menu - so topTrigger below switches that and everything
	underneath is shared. Duplicating the item lists per layout would have guaranteed they drift.
-->
{#snippet topTrigger(id: string, index: number, label: string, opts: { disabled?: boolean; title?: string; dot?: boolean } = {})}
	{#if index >= visible}
		<Menu.TriggerItem value={id} class={itemClass} disabled={opts.disabled} title={opts.title ?? ''}>
			<Menu.ItemText>{label}</Menu.ItemText>
			<span class="flex items-center gap-1.5">
				{#if opts.dot}<span class="bg-primary-500 inline-block size-1.5 rounded-full"></span>{/if}
				<ChevronRight class="size-4 opacity-60" />
			</span>
		</Menu.TriggerItem>
	{:else}
		<Menu.Trigger class={triggerClass} disabled={opts.disabled} title={opts.title ?? ''}>
			{label}
			{#if opts.dot}<span class="bg-primary-500 mb-1.5 ml-0.5 inline-block size-1.5 rounded-full"></span>{/if}
		</Menu.Trigger>
	{/if}
{/snippet}

{#snippet topMenus(overflow: boolean)}
	{#if showAt(0, overflow)}
		<Menu onSelect={(d) => fileSelect(d.value)}>
			{@render topTrigger('file', 0, m.menubar_menu_file())}
			<Portal>
				<Menu.Positioner>
					<Menu.Content class={contentClass}>
						<Menu onSelect={(d) => newFileSelect(d.value)}>
							<Menu.TriggerItem value="new" class={itemClass}>
								<Menu.ItemText>{m.menubar_new_file_menu()}</Menu.ItemText><ChevronRight class="size-4 opacity-60" />
							</Menu.TriggerItem>
							<Portal>
								<Menu.Positioner>
									<Menu.Content class={contentClass}>
										<Menu.Item value="tex" class={itemClass}><Menu.ItemText>{m.menubar_new_tex()}</Menu.ItemText></Menu.Item>
										<Menu.Item value="bib" class={itemClass}><Menu.ItemText>{m.menubar_new_bib()}</Menu.ItemText></Menu.Item>
										<Menu.Item value="cls" class={itemClass}><Menu.ItemText>{m.menubar_new_cls()}</Menu.ItemText></Menu.Item>
										<Menu.Item value="sty" class={itemClass}><Menu.ItemText>{m.menubar_new_sty()}</Menu.ItemText></Menu.Item>
									</Menu.Content>
								</Menu.Positioner>
							</Portal>
						</Menu>
						<Menu onSelect={(d) => openFolderSelect(d.value)}>
							<Menu.TriggerItem value="openfolder" class={itemClass}>
								<Menu.ItemText>{m.menubar_open_folder_menu()}</Menu.ItemText><ChevronRight class="size-4 opacity-60" />
							</Menu.TriggerItem>
							<Portal>
								<Menu.Positioner>
									<Menu.Content class={contentClass}>
										<Menu.Item value="newfolder" class={itemClass}><Menu.ItemText>{m.menubar_open_new_folder()}</Menu.ItemText></Menu.Item>
										{#if $recentFolders.length > 0}
											<Menu.Separator class="border-surface-200-800 my-1 border-t" />
											<div class="text-surface-500 px-2.5 py-0.5 text-xs font-semibold tracking-wider uppercase">
												{m.menubar_recent_heading()}
											</div>
											{#each $recentFolders as folder (folder)}
												<Menu.Item value={folder} class={itemClass}>
													<Menu.ItemText class="block max-w-64 truncate" title={folder}>{basename(folder)}</Menu.ItemText>
												</Menu.Item>
											{/each}
										{/if}
									</Menu.Content>
								</Menu.Positioner>
							</Portal>
						</Menu>
						{#if isDesktop()}
							<Menu.Separator class="border-surface-200-800 my-1 border-t" />
							<Menu.Item value="new-window" class={itemClass}>
								<Menu.ItemText>{m.menubar_new_window()}</Menu.ItemText><span class="opacity-50">{combo({ shift: true }, 'N')}</span>
							</Menu.Item>
							<Menu.Item value="open-folder-new-window" class={itemClass}>
								<Menu.ItemText>{m.menubar_open_folder_new_window()}</Menu.ItemText>
							</Menu.Item>
						{/if}
						<Menu.Separator class="border-surface-200-800 my-1 border-t" />
						<Menu.Item value="save" class={itemClass}>
							<Menu.ItemText>{m.menubar_save()}</Menu.ItemText><span class="opacity-50">{combo({}, 'S')}</span>
						</Menu.Item>
						{#if onCloseWorkspace}
							<Menu.Item value="close-workspace" class={itemClass}><Menu.ItemText>{m.menubar_close_workspace()}</Menu.ItemText></Menu.Item>
						{/if}
						<!-- Preferences and Share session moved to the app-icon menu (AppIconMenu.svelte),
							     which is where macOS puts them and where Windows now matches. The values are
							     still handled in fileSelect: the native macOS app menu fires them. -->
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu>
	{/if}

	{#if showAt(1, overflow)}
		<Menu onSelect={(d) => (d.value === 'palette' ? commandPalette.show() : editSelect(d.value))}>
			{@render topTrigger('edit', 1, m.menubar_menu_edit(), { disabled })}
			<Portal>
				<Menu.Positioner>
					<Menu.Content class={contentClass}>
						<Menu.Item value="palette" class={itemClass}>
							<Menu.ItemText>{m.palette_open()}</Menu.ItemText><span class="opacity-50">{combo({}, 'K')}</span>
						</Menu.Item>
						<Menu.Separator class="border-surface-200-800 my-1 border-t" />
						<Menu.Item value="undo" class={itemClass}
							><Menu.ItemText>{m.menubar_undo()}</Menu.ItemText><span class="opacity-50">{combo({}, 'Z')}</span></Menu.Item
						>
						<Menu.Item value="redo" class={itemClass}
							><Menu.ItemText>{m.menubar_redo()}</Menu.ItemText><span class="opacity-50">{combo({ shift: true }, 'Z')}</span></Menu.Item
						>
						<Menu.Separator class="border-surface-200-800 my-1 border-t" />
						<Menu.Item value="find" class={itemClass}
							><Menu.ItemText>{m.menubar_find()}</Menu.ItemText><span class="opacity-50">{combo({}, 'F')}</span></Menu.Item
						>
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu>
	{/if}

	{#if showAt(2, overflow)}
		<Menu onSelect={(d) => viewSelect(d.value)}>
			{@render topTrigger('view', 2, m.menubar_menu_view())}
			<Portal>
				<Menu.Positioner>
					<Menu.Content class={contentClass}>
						<div class="text-surface-500 px-2.5 py-1 text-xs">{m.menubar_interface_zoom({ percent: uiZoomPercent })}</div>
						<Menu.Separator class="border-surface-200-800 my-1 border-t" />
						<Menu.Item value="zoom-in" class={itemClass}>
							<Menu.ItemText>{m.menubar_zoom_in()}</Menu.ItemText><span class="opacity-50">{isMac ? '⌘ +' : 'Ctrl +'}</span>
						</Menu.Item>
						<Menu.Item value="zoom-out" class={itemClass}>
							<Menu.ItemText>{m.menubar_zoom_out()}</Menu.ItemText><span class="opacity-50">{isMac ? '⌘ −' : 'Ctrl −'}</span>
						</Menu.Item>
						<Menu.Item value="zoom-reset" class={itemClass}>
							<Menu.ItemText>{m.menubar_zoom_reset()}</Menu.ItemText><span class="opacity-50">{isMac ? '⌘ 0' : 'Ctrl 0'}</span>
						</Menu.Item>
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu>
	{/if}

	{#if showAt(3, overflow)}
		<Menu onSelect={(d) => void insertSelect(d.value)}>
			{@render topTrigger('insert', 3, m.menubar_menu_insert(), {
				disabled: disabled || $cursorInCm,
				title: $cursorInCm ? m.menubar_cursor_in_cm_hint() : ''
			})}
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
										<Menu.Separator class="border-surface-200-800 my-1 border-t" />
										<Menu.Item value="align" class={itemClass}><Menu.ItemText>Align</Menu.ItemText></Menu.Item>
										<Menu.Item value="aligned" class={itemClass}><Menu.ItemText>Aligned</Menu.ItemText></Menu.Item>
										<Menu.Item value="gather" class={itemClass}><Menu.ItemText>Gather</Menu.ItemText></Menu.Item>
										<Menu.Item value="cases" class={itemClass}><Menu.ItemText>Cases</Menu.ItemText></Menu.Item>
										<Menu.Item value="multline" class={itemClass}><Menu.ItemText>Multline</Menu.ItemText></Menu.Item>
										<Menu.Item value="split" class={itemClass}><Menu.ItemText>Split</Menu.ItemText></Menu.Item>
										<Menu.Separator class="border-surface-200-800 my-1 border-t" />
										<Menu.Item value="bmatrix" class={itemClass}><Menu.ItemText>{m.menubar_math_matrix_square()}</Menu.ItemText></Menu.Item>
										<Menu.Item value="pmatrix" class={itemClass}><Menu.ItemText>{m.menubar_math_matrix_paren()}</Menu.ItemText></Menu.Item>
									</Menu.Content>
								</Menu.Positioner>
							</Portal>
						</Menu>
						<Menu.Item value="image" class={itemClass}><Menu.ItemText>{m.menubar_insert_image()}</Menu.ItemText></Menu.Item>
						<Menu.Item value="table" class={itemClass}><Menu.ItemText>{m.menubar_insert_table()}</Menu.ItemText></Menu.Item>
						<Menu.Item value="citation" class={itemClass}><Menu.ItemText>{m.menubar_insert_citation()}</Menu.ItemText></Menu.Item>
						<Menu.Item value="link" class={itemClass}><Menu.ItemText>{m.menubar_insert_link()}</Menu.ItemText></Menu.Item>
						<Menu.Item value="code" class={itemClass}><Menu.ItemText>{m.menubar_insert_code_block()}</Menu.ItemText></Menu.Item>
						<Menu.Item value="hrule" class={itemClass}><Menu.ItemText>{m.menubar_insert_hrule()}</Menu.ItemText></Menu.Item>
						<Menu.Separator class="border-surface-200-800 my-1 border-t" />
						<Menu.Item value="environment" class={itemClass}><Menu.ItemText>{m.menubar_insert_environment()}</Menu.ItemText></Menu.Item>
						<Menu.Item value="rawlatex" class={itemClass}><Menu.ItemText>{m.menubar_insert_raw_latex()}</Menu.ItemText></Menu.Item>
						<Menu.Item value="inlinelatex" class={itemClass}><Menu.ItemText>{m.menubar_insert_inline_latex()}</Menu.ItemText></Menu.Item>
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu>
	{/if}

	{#if showAt(4, overflow)}
		<Menu onSelect={(d) => (d.value === 'format-document' ? onFormatDocument?.() : formatSelect(d.value))}>
			{@render topTrigger('format', 4, m.menubar_menu_format(), {
				disabled: disabled || $cursorInCm,
				title: $cursorInCm ? m.menubar_cursor_in_cm_hint() : ''
			})}
			<Portal>
				<Menu.Positioner>
					<Menu.Content class={contentClass}>
						<Menu.Item value="bold" class={itemClass}
							><Menu.ItemText>{m.menubar_format_bold()}</Menu.ItemText><span class="opacity-50">{combo({}, 'B')}</span></Menu.Item
						>
						<Menu.Item value="italic" class={itemClass}
							><Menu.ItemText>{m.menubar_format_italic()}</Menu.ItemText><span class="opacity-50">{combo({}, 'I')}</span></Menu.Item
						>
						<Menu.Item value="underline" class={itemClass}
							><Menu.ItemText>{m.menubar_format_underline()}</Menu.ItemText><span class="opacity-50">{combo({}, 'U')}</span></Menu.Item
						>
						<Menu.Item value="code" class={itemClass}><Menu.ItemText>{m.menubar_format_inline_code()}</Menu.ItemText></Menu.Item>
						<Menu.Separator class="border-surface-200-800 my-1 border-t" />
						<Menu.Item value="h1" class={itemClass}><Menu.ItemText>{m.menubar_heading_1()}</Menu.ItemText></Menu.Item>
						<Menu.Item value="h2" class={itemClass}><Menu.ItemText>{m.menubar_heading_2()}</Menu.ItemText></Menu.Item>
						<Menu.Item value="h3" class={itemClass}><Menu.ItemText>{m.menubar_heading_3()}</Menu.ItemText></Menu.Item>
						<Menu.Item value="quote" class={itemClass}><Menu.ItemText>{m.menubar_format_blockquote()}</Menu.ItemText></Menu.Item>
						{#if onFormatDocument}
							<Menu.Separator class="border-surface-200-800 my-1 border-t" />
							<Menu.Item value="format-document" class={itemClass}><Menu.ItemText>{m.menubar_format_document()}</Menu.ItemText></Menu.Item>
						{/if}
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu>
	{/if}

	{#if showAt(5, overflow)}
		<Menu onSelect={(d) => spellcheckSelect(d.value)}>
			{@render topTrigger('spelling', 5, m.menubar_menu_spelling(), { disabled })}
			<Portal>
				<Menu.Positioner>
					<Menu.Content class={contentClass}>
						<Menu.Item value="toggle" class={itemClass}>
							<Menu.ItemText>{m.menubar_check_spelling()}</Menu.ItemText>
							{#if spellcheckOn}<Check class="size-4" />{/if}
						</Menu.Item>
						<Menu.Separator class="border-surface-200-800 my-1 border-t" />
						<Menu.Item value="dictionary" class={itemClass}><Menu.ItemText>{m.menubar_edit_dictionary()}</Menu.ItemText></Menu.Item>
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu>
	{/if}

	{#if terminalAvailable}
		{#if showAt(6, overflow)}
			<Menu onSelect={(d) => terminalSelect(d.value)}>
				{@render topTrigger('terminal', 6, m.menubar_menu_terminal())}
				<Portal>
					<Menu.Positioner>
						<Menu.Content class={contentClass}>
							<Menu.Item value="compile" class={itemClass}><Menu.ItemText>{m.menubar_terminal_compile()}</Menu.ItemText></Menu.Item>
							<Menu.Item value="configure" class={itemClass}
								><Menu.ItemText>{m.menubar_configure_compile_command()}</Menu.ItemText></Menu.Item
							>
							<Menu.Separator class="border-surface-200-800 my-1 border-t" />
							<Menu.Item value="new" class={itemClass}><Menu.ItemText>{m.menubar_new_terminal()}</Menu.ItemText></Menu.Item>
							<Menu.Item value="toggle" class={itemClass}>
								<Menu.ItemText>{m.menubar_show_terminal()}</Menu.ItemText>
								{#if terminalVisible}<Check class="size-4" />{/if}
							</Menu.Item>
						</Menu.Content>
					</Menu.Positioner>
				</Portal>
			</Menu>
		{/if}
	{/if}

	{#if showAt(helpIndex, overflow)}
		<Menu onSelect={(d) => (d.value === 'tutorial' ? onOpenTutorial?.() : helpSelect(d.value))}>
			<!-- dot: an update finished downloading in the background, or there are release notes the
				     user has not opened. Either way the badge points at an item inside this menu. -->
			{@render topTrigger('help', helpIndex, m.menubar_menu_help(), {
				dot: $updateState.phase === 'downloaded' || $hasUnseenWhatsNew
			})}
			<Portal>
				<Menu.Positioner>
					<Menu.Content class={contentClass}>
						<Menu.Item value="shortcuts" class={itemClass}><Menu.ItemText>{m.menubar_keyboard_shortcuts()}</Menu.ItemText></Menu.Item>
						{#if onOpenTutorial}
							<Menu.Item value="tutorial" class={itemClass}><Menu.ItemText>{m.menubar_open_tutorial()}</Menu.ItemText></Menu.Item>
						{/if}
						<Menu.Item value="whatsnew" class={itemClass}>
							<Menu.ItemText>{m.whatsnew_menu_label()}</Menu.ItemText>
							{#if $hasUnseenWhatsNew}
								<span class="bg-primary-500 inline-block size-1.5 rounded-full"></span>
							{/if}
						</Menu.Item>
						<Menu.Separator class="border-surface-200-800 my-1 border-t" />
						<Menu.Item value="discord" class={itemClass}><Menu.ItemText>{m.menubar_join_discord()}</Menu.ItemText></Menu.Item>
						<Menu.Item value="support" class={itemClass}><Menu.ItemText>{m.menubar_contact_support()}</Menu.ItemText></Menu.Item>
						<Menu.Separator class="border-surface-200-800 my-1 border-t" />
						<Menu.Item value="updates" class={itemClass}>
							<Menu.ItemText>{m.menubar_check_for_updates()}</Menu.ItemText>
							{#if $updateState.phase === 'downloaded'}
								<span class="bg-primary-500 inline-block size-1.5 rounded-full"></span>
							{/if}
						</Menu.Item>
						<div class="text-surface-500 px-2.5 py-1 text-xs">{m.menubar_version_footer({ version: appVersion })}</div>
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu>
	{/if}
{/snippet}

<!-- outside the nav so it survives on macOS, where the nav is not rendered at all -->
<input bind:this={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="hidden" onchange={onImagePicked} />

<SpellcheckDictionary bind:open={dictionaryOpen} />
<!-- bound to a store, not local state: the command palette opens Preferences too, and it has no
     handle on this component -->
<PreferencesDialog bind:open={$preferencesOpen} />

<!-- text prompt dialog, Electron has no window.prompt() -->
{#if promptOpen}
	<div
		class="fixed inset-0 z-1300 flex items-center justify-center bg-black/40 p-4"
		role="presentation"
		onmousedown={(e) => e.target === e.currentTarget && closePrompt(false)}
	>
		<div class="card bg-surface-50-950 border-surface-300-700 w-full max-w-sm border p-4 shadow-2xl">
			<div class="mb-2 text-sm font-medium">{promptTitle}</div>
			<input
				bind:this={promptInput}
				bind:value={promptValue}
				class="input w-full"
				onkeydown={(e) => {
					if (e.key === 'Enter') closePrompt(true);
					else if (e.key === 'Escape') closePrompt(false);
				}}
			/>
			<div class="mt-4 flex justify-end gap-2">
				<button class="btn btn-sm hover:preset-tonal" type="button" onclick={() => closePrompt(false)}>{m.menubar_prompt_cancel()}</button>
				<button class="btn btn-sm preset-filled-primary-500" type="button" onclick={() => closePrompt(true)}>{m.menubar_prompt_ok()}</button
				>
			</div>
		</div>
	</div>
{/if}

<svelte:window onkeydown={(e) => e.key === 'Escape' && ((shortcutsOpen = false), (supportOpen = false))} />

{#if shortcutsOpen}
	<div
		class="fixed inset-0 z-1300 flex items-center justify-center bg-black/40 p-4"
		role="presentation"
		onmousedown={(e) => e.target === e.currentTarget && (shortcutsOpen = false)}
	>
		<div class="card bg-surface-50-950 border-surface-300-700 w-full max-w-md border p-5 shadow-2xl">
			<div class="mb-3 flex items-center justify-between gap-4">
				<h2 class="text-base font-semibold">{m.menubar_keyboard_shortcuts()}</h2>
				<button class="btn-icon btn-icon-sm hover:preset-tonal" aria-label={m.menubar_close_aria()} onclick={() => (shortcutsOpen = false)}
					><X class="size-4" /></button
				>
			</div>
			<div class="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
				{#each SHORTCUTS as grp (grp.group)}
					<div>
						<div class="text-surface-500 mb-1.5 text-xs font-semibold tracking-wider uppercase">{grp.group}</div>
						<ul class="space-y-1">
							{#each grp.items as s (s.label)}
								<li class="flex items-center justify-between gap-4 text-sm">
									<span>{s.label}</span>
									<!-- raw, not keys: combo() has already resolved the per-OS symbols, and several
									     entries here are composites the parser cannot express ("F12 / ⌘ Click") -->
									<Kbd cap raw={s.keys} />
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<!-- shows the email with a copy button, no mail client assumed -->
{#if supportOpen}
	<div
		class="fixed inset-0 z-1300 flex items-center justify-center bg-black/40 p-4"
		role="presentation"
		onmousedown={(e) => e.target === e.currentTarget && (supportOpen = false)}
	>
		<div class="card bg-surface-50-950 border-surface-300-700 w-full max-w-sm border p-5 shadow-2xl">
			<div class="mb-3 flex items-center justify-between gap-4">
				<h2 class="text-base font-semibold">{m.menubar_contact_support()}</h2>
				<button class="btn-icon btn-icon-sm hover:preset-tonal" aria-label={m.menubar_close_aria()} onclick={() => (supportOpen = false)}
					><X class="size-4" /></button
				>
			</div>
			<p class="text-surface-600-400 mb-2 text-sm">{m.menubar_support_email_intro()}</p>
			<div class="border-surface-300-700 bg-surface-100-900 flex items-center justify-between gap-3 rounded border px-3 py-2">
				<code class="text-sm select-all">{SUPPORT_EMAIL}</code>
				<button class="btn btn-sm preset-tonal-primary shrink-0" onclick={copyEmail}
					>{copied ? m.menubar_copied() : m.menubar_copy()}</button
				>
			</div>
		</div>
	</div>
{/if}
