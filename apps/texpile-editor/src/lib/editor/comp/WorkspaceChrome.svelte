<script lang="ts">
	// The workspace's chrome: the menu bar (or the guest banner in its place) and the left sidebar
	// with its drag handle. Like WorkspaceMain, this reads from the shared state objects rather
	// than a long prop list.
	import TitleBar from '$lib/editor/comp/chrome/TitleBar.svelte';
	import AppIconMenu from '$lib/editor/comp/chrome/AppIconMenu.svelte';
	import WorkspaceMenuBar from '$lib/editor/comp/WorkspaceMenuBar.svelte';
	import SessionPresence from '$lib/editor/comp/chrome/SessionPresence.svelte';
	import WorkspaceSidebar from '$lib/editor/comp/WorkspaceSidebar.svelte';
	import GuestPresence from '$lib/collab/GuestPresence.svelte';
	import WorkspaceDialogs from '$lib/editor/comp/WorkspaceDialogs.svelte';
	import type GlobalSearch from '$lib/editor/comp/GlobalSearch.svelte';
	import type { PaneLayout } from '$lib/workspace/paneLayout.svelte';
	import type { ViewModeSwitch } from '$lib/workspace/viewModeSwitch.svelte';
	import type { TerminalDockState } from '$lib/workspace/terminalDockState.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { Snippet } from 'svelte';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the pipelines are structural here
	type Any = any;

	let {
		children,
		layout = $bindable(),
		modes,
		termDock = $bindable(),
		compiler,
		scm,
		treeOps,
		guest,
		modLabel,
		showToc,
		menu,
		actions,
		fileTreeRef = $bindable(),
		globalSearchRef = $bindable()
	}: {
		/** the editor column, rendered as a sibling of the sidebar inside the row */
		children: Snippet;
		layout: PaneLayout;
		modes: ViewModeSwitch;
		termDock: TerminalDockState;
		compiler: Any;
		scm: Any;
		treeOps: Any;
		guest: boolean;
		modLabel: string;
		showToc: boolean;
		/** menu-bar inputs that are not workspace state */
		menu: { disabled: boolean; imageDir: string | undefined; shareable: boolean; uiZoomPercent: number };
		actions: Any;
		fileTreeRef: Any;
		globalSearchRef: GlobalSearch | null;
	} = $props();
</script>

{#if guest}
	<!-- a guest has no menus, but a frameless window still needs somewhere to drag it by and a
	     close button. Session state rides in the same trailing slot the host's presence uses,
	     rather than in a full-width row of its own below. -->
	<TitleBar>
		{#snippet status()}
			<GuestPresence />
		{/snippet}
	</TitleBar>
{:else}
	<!-- the menus live inside the custom title bar, on one row with the app icon and the window
	     buttons. On macOS TitleBar renders the row but WorkspaceMenuBar draws no triggers - the
	     system menu bar has them - while still mounting to own its dialogs. -->
	<TitleBar>
		{#snippet appMenu()}
			<AppIconMenu onShareSession={menu.shareable ? actions.openShare : undefined} />
		{/snippet}
		{#snippet status()}
			<SessionPresence onShareSession={menu.shareable ? actions.openShare : undefined} />
		{/snippet}
		{#snippet menus()}
			<WorkspaceMenuBar
				disabled={menu.disabled}
				imageDir={menu.imageDir}
				onNewFile={actions.newFileOfType}
				onOpenFolder={actions.openFolder}
				onCloseWorkspace={actions.closeWorkspace}
				onSave={actions.save}
				onShareSession={menu.shareable ? actions.openShare : undefined}
				terminalAvailable={termDock.available}
				terminalVisible={termDock.visible}
				onCompile={compiler.runCompile}
				onConfigureCompile={actions.openCompileModal}
				onNewTerminal={actions.newTerminal}
				onToggleTerminal={actions.toggleTerminal}
				onFormatDocument={actions.openFormatModal}
				onOpenTutorial={actions.openTutorial}
				uiZoomPercent={menu.uiZoomPercent}
				onZoomIn={actions.uiZoomIn}
				onZoomOut={actions.uiZoomOut}
				onZoomReset={actions.uiZoomReset}
			/>
		{/snippet}
	</TitleBar>
{/if}

<!-- outside the branch on purpose: a guest reaches Preferences through the palette and has no menu
     bar to have mounted these -->
<WorkspaceDialogs />

<div class="flex min-h-0 flex-1 overflow-hidden">
	{#if layout.sidebarOpen}
		<WorkspaceSidebar
			width={layout.sidebarWidth}
			{guest}
			{modLabel}
			bind:view={layout.sidebarView}
			scmBusy={scm.busy}
			{showToc}
			tocFraction={layout.tocFraction}
			viewMode={modes.mode}
			bind:fileTreeRef
			bind:globalSearchRef
			bind:splitEl={layout.splitEl}
			onRefreshTree={actions.refreshTree}
			onOpenGlobalSearch={actions.openGlobalSearch}
			onCloseGlobalSearch={actions.closeGlobalSearch}
			onOpenFileAt={actions.openFileAt}
			onOpenEntry={actions.openEntry}
			onCreate={treeOps.create}
			onRename={treeOps.rename}
			onDelete={treeOps.deleteMany}
			onMove={treeOps.moveMany}
			onImport={treeOps.import}
			onCopyIn={treeOps.copyIn}
			onSetMain={actions.setMain}
			onStartTocResize={layout.startTocResize}
			onResizeTocByKey={layout.resizeTocByKey}
			onRefreshGit={actions.refreshGit}
			scmInit={scm.init}
			scmStage={scm.stage}
			scmUnstage={scm.unstage}
			scmDiscard={scm.discard}
			scmCommit={scm.commit}
			scmOpenDiff={scm.openDiff}
		/>

		<!-- same WAI-ARIA window-splitter pattern as the other panes; svelte's a11y rule doesn't special-case it -->
		<!-- eslint-disable-next-line svelte/valid-compile -->
		<div
			class="hover:bg-primary-500/40 active:bg-primary-500/60 relative z-20 -mx-[3px] w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors"
			onmousedown={layout.startSidebarResize}
			onkeydown={layout.resizeSidebarByKey}
			role="separator"
			aria-orientation="vertical"
			aria-label={m.wsview_resize_sidebar_aria()}
			tabindex="0"
		></div>
	{/if}

	{@render children()}
</div>
