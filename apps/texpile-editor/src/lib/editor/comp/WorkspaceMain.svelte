<script lang="ts">
	// The editor column: toolbar, editor/preview pair, and the bottom dock. Everything here reads
	// from the workspace's state objects rather than a long list of scalar props, which is what
	// makes this splittable at all - the state lives in lib/workspace/*.svelte.ts, not in the view.
	import EditorTopbar from '$lib/editor/comp/EditorTopbar.svelte';
	import EditorPane from '$lib/editor/comp/EditorPane.svelte';
	import PreviewPane from '$lib/editor/comp/PreviewPane.svelte';
	import PreviewPopout from '$lib/editor/comp/PreviewPopout.svelte';
	import PaneSplitter from '$lib/editor/comp/PaneSplitter.svelte';
	import TerminalDock from '$lib/editor/comp/TerminalDock.svelte';
	import { ChevronLeft } from '@lucide/svelte';
	import { m } from '$lib/paraglide/messages';
	import type DraftView from '$lib/draft/DraftView.svelte';
	import type { DocumentBuffer, FileKind } from '$lib/workspace/documentBuffer.svelte';
	import type { ViewModeSwitch } from '$lib/workspace/viewModeSwitch.svelte';
	import type { PaneLayout } from '$lib/workspace/paneLayout.svelte';
	import type { DiffMode } from '$lib/workspace/diffMode.svelte';
	import type { VisualParser } from '$lib/workspace/visualParse.svelte';
	import type { TerminalDockState } from '$lib/workspace/terminalDockState.svelte';

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the pipelines are structural here
	type Any = any;

	let {
		doc,
		modes,
		layout = $bindable(),
		diff,
		parser,
		termDock = $bindable(),
		compiler,
		saver,
		session,
		guest,
		kind,
		nameOnly,
		folderEmpty,
		modLabel,
		dockShrunk,
		draft,
		typstPreviewHost,
		typstPreviewWanted,
		mainIsTypst,
		guestTypstOffered,
		mainUnset,
		onPickMain,
		panes,
		actions,
		dockView = $bindable(),
		pdfPaneRef = $bindable(),
		draftRef = $bindable()
	}: {
		doc: DocumentBuffer;
		modes: ViewModeSwitch;
		layout: PaneLayout;
		diff: DiffMode;
		parser: VisualParser;
		termDock: TerminalDockState;
		compiler: Any;
		saver: Any;
		session: Any;
		guest: boolean;
		kind: FileKind;
		nameOnly: boolean;
		folderEmpty: boolean;
		modLabel: string;
		dockShrunk: boolean;
		/** live-preview inputs: root, main file, recompile trigger, paused flag */
		draft: { root: string; mainRel: string; trigger: number; paused: boolean };
		/** `host:port` of a running Typst preview, null while one is still starting */
		typstPreviewHost: string | null;
		/** this pane is for a Typst preview, even before it has an address */
		typstPreviewWanted: boolean;
		/** the main file is .typ, so Typst owns the output even when its preview is unavailable */
		mainIsTypst: boolean;
		/** guest: the host streams its live Typst preview, shown instead of the pushed PDF */
		guestTypstOffered: boolean;
		/** no main file in a folder that has candidates: the pane shows the pick-a-main message */
		mainUnset: boolean;
		/** open the set-main-file prompt (the pane's message carries the button) */
		onPickMain: () => void;
		/** editor inputs that are not workspace state: tabs, references, jump targets */
		panes: Any;
		actions: Any;
		dockView: 'terminal' | 'problems' | 'comments';
		pdfPaneRef: Any;
		draftRef: DraftView | null;
	} = $props();

	// One gate for every forward-sync entry point: the docked chip, the popped-out button, and
	// the context menu's "Show in preview/PDF". Guest: the open file must match what the host's
	// pane shows - a streamed Typst preview syncs .typ files, a pushed PDF syncs .tex ones (via
	// the host's SyncTeX data). Host: same rule against the main file's engine; Typst syncs only
	// through the live preview (no SyncTeX in its PDFs), so a shell-compiled .typ gets no entry
	// points at all, and diff has no caret to sync.
	const canSync = $derived(
		guest
			? guestTypstOffered
				? kind === 'typ'
				: kind === 'tex'
			: (mainIsTypst ? kind === 'typ' && typstPreviewWanted : kind === 'tex') && modes.mode !== 'diff'
	);
	const syncToCursor = $derived(canSync ? (actions.syncForward as () => void) : null);
</script>

<main
	class="grid min-h-0 min-w-0 flex-1"
	style="grid-template-columns: minmax(0, 1fr) auto auto; grid-template-rows: auto minmax(0, 1fr) auto auto"
>
	<EditorTopbar
		loadedPath={doc.path}
		{kind}
		viewMode={modes.mode}
		{guest}
		terminalAvailable={termDock.available}
		compiling={compiler.compiling}
		{typstPreviewWanted}
		pdfPaneOpen={layout.pdfPaneOpen}
		draftPaused={draft.paused}
		saving={saver.saving}
		{modLabel}
		onSetViewMode={actions.setViewMode}
		onStopCompile={compiler.stopCompile}
		onPauseDraft={actions.pauseDraft}
		onResumeDraft={actions.resumeDraft}
		onCompile={compiler.runCompile}
		commandPending={panes.commandPending}
		onRequestCompile={actions.requestCompile}
		onConfigureCompile={actions.openCompileModal}
		onShowProblems={actions.showProblems}
		commentCount={panes.comments.filter((t: Any) => !t.resolved).length}
		onShowComments={actions.showComments}
		onTogglePdf={layout.togglePdfPane}
		onSave={actions.save}
		onSyncToCursor={layout.pdfPopout && !mainUnset ? syncToCursor : null}
		syncTargetsPreview={guest ? guestTypstOffered : typstPreviewWanted}
	/>

	<!-- editor column (toolbar + content) with the PDF pane beside it, so the PDF skips the
	     toolbar while the header (Compile) stays above it. the wrapper is display:contents so
	     editor/splitter/preview place themselves on main's grid -->
	<div class="contents">
		<EditorPane
			openTabs={panes.openTabs}
			previewTab={panes.previewTab}
			onActivateTab={actions.activateTab}
			onCloseTab={actions.closeTab}
			onKeepTab={actions.keepTab}
			loadedPath={doc.path}
			{kind}
			{nameOnly}
			viewMode={modes.mode}
			{session}
			{folderEmpty}
			loadError={doc.loadError}
			applyingStarter={panes.applyingStarter}
			texSource={doc.texSource}
			rawContent={doc.rawContent}
			visualDoc={doc.visualDoc}
			parseProgress={parser.progress}
			onUseSource={actions.useSource}
			docMeta={doc.docMeta}
			allReferences={panes.allReferences}
			sourceGotoLine={panes.sourceGotoLine}
			sourceScrollAnchor={modes.sourceScrollAnchor}
			sourceDiagnostics={panes.sourceDiagnostics}
			diffOriginal={diff.original}
			diffModified={diff.modified}
			diffLayout={diff.layout}
			diffLoading={diff.loading}
			diffError={diff.error}
			diffHasHead={diff.hasHead}
			fileUrl={panes.fileUrl}
			onPickStarter={actions.pickStarter}
			onBlankStarter={actions.newTexFile}
			onImportStarter={actions.importStarter}
			onTexInput={actions.onTexInput}
			onRawInput={actions.onRawInput}
			onVisualChange={actions.onVisualChange}
			onVisualSelection={actions.onVisualSelection}
			onEditFrontmatter={actions.onEditFrontmatter}
			onSyncToPdf={canSync ? actions.syncToPdf : undefined}
			onHistoryBoundary={actions.historyStep}
			onJumpToFile={actions.jumpToFile}
			onOpenFileAt={actions.openFileAt}
			onCaretMove={actions.onCaretMove}
			onToggleDiffLayout={() => diff.toggleLayout()}
			onRefreshDiff={actions.refreshDiff}
			onExitDiff={actions.exitDiff}
			commentRanges={panes.commentRanges}
			commentThreads={panes.comments.filter((t) => t.file === panes.commentFile)}
			selectedComment={panes.commentSelected}
			onAddComment={actions.beginComment}
			commentPendingActive={!!panes.commentPending}
			onInsertCitation={panes.zoteroCite ? actions.insertZoteroCitation : undefined}
			onAddCommentAnchored={actions.beginCommentAnchored}
			onCommentsPlaced={actions.visualCommentsPlaced}
			onSelectComment={actions.selectComment}
		/>
		{#if layout.pdfPaneOpen && !layout.pdfPopout}
			<PreviewPane
				width={layout.pdfPaneWidth}
				{dockShrunk}
				{guest}
				guestPdf={session.guestPdf}
				pdfFilename={compiler.pdfFilename}
				draftRoot={draft.root}
				draftMainRel={draft.mainRel}
				draftTrigger={draft.trigger}
				{typstPreviewHost}
				{typstPreviewWanted}
				{guestTypstOffered}
				{mainUnset}
				{onPickMain}
				onSaveTypstPdf={actions.onSaveTypstPdf}
				onSyncToCursor={syncToCursor}
				onPopout={() => layout.setPdfPopout(true)}
				paneDragging={layout.paneDragging}
				bind:pdfPaneRef
				bind:draftRef
				onStartResize={layout.startPdfResize}
				onResizeByKey={layout.resizePdfByKey}
				onClose={layout.togglePdfPane}
				onPageClick={actions.onPdfDoubleClick}
				onInverseSync={actions.onInverseSync}
				onSettled={actions.onPreviewSettled}
				onDiagnostics={actions.onPreviewDiagnostics}
			/>
		{:else if termDock.available || guest || layout.pdfPopout}
			<!-- the pane is gone but its divider stays, on the editor's right edge with the chevron
			     flipped: that is the way back, now that the toolbar has no toggle. Not resizable -
			     there is nothing to size - so it loses the drag cursor too.

			     mr-[7px] holds the rule off the window edge. The lozenge is centred on it like every
			     other one, and its chevron is 14px against a 7px lozenge, so the glyph needs 7px of
			     clearance or the window edge cuts it in half - there is no pane out there to
			     overhang into.

			     It spans every row so the rule reaches the bottom of the window: with the preview shut
			     the dock stops at the editor column (see dockShrunk), and a rail that stopped at the
			     editor would leave a notch beside it.

			     bottomInset then holds the toggle level with the one it took over from. PreviewPane's
			     divider spans past the dock only when shrink is on; when it is off that divider ends
			     above the dock, so this one has to discount the same height or the lozenge slides
			     down the screen the moment you close the pane. -->
			<!-- resizable while shut on purpose: dragging it back into the window is the other half of
			     the drag-to-close gesture, so the rail has to accept the same drag the real divider
			     does. PaneLayout measures from the edge in this state. -->
			<PaneSplitter
				resizable
				resizeLabel={m.wsview_resize_pdf_preview_aria()}
				onStartResize={layout.startPdfResize}
				onResizeByKey={layout.resizePdfByKey}
				toggle={{
					icon: ChevronLeft,
					// while the preview is popped out this rail is what stands in for the pane, so
					// its chevron brings the window home rather than opening a second body
					onclick: () => (layout.pdfPopout ? layout.setPdfPopout(false) : layout.togglePdfPane()),
					title: m.wsview_toggle_pdf_preview(),
					ariaLabel: m.wsview_toggle_pdf_preview()
				}}
				bottomInset={termDock.shrink || !termDock.visible ? 0 : termDock.height}
				class="z-20 mr-[7px]"
				style="grid-column: 3; grid-row: 2 / -1"
			/>
		{/if}
		{#if layout.pdfPaneOpen && layout.pdfPopout}
			<PreviewPopout
				{guest}
				guestPdf={session.guestPdf}
				{guestTypstOffered}
				{mainUnset}
				{onPickMain}
				pdfFilename={compiler.pdfFilename}
				draftRoot={draft.root}
				draftMainRel={draft.mainRel}
				draftTrigger={draft.trigger}
				{typstPreviewHost}
				{typstPreviewWanted}
				onSaveTypstPdf={actions.onSaveTypstPdf}
				onPdfRef={(r) => (pdfPaneRef = r)}
				onDraftRef={(r) => (draftRef = r)}
				onClosed={() => layout.setPdfPopout(false)}
				onPageClick={actions.onPdfDoubleClick}
				onInverseSync={actions.onInverseSync}
				onSettled={actions.onPreviewSettled}
				onDiagnostics={actions.onPreviewDiagnostics}
			/>
		{/if}
	</div>

	{#if termDock.mounted && (termDock.available || guest)}
		<TerminalDock
			terminalEnabled={termDock.available}
			visible={termDock.visible}
			height={termDock.height}
			shrink={termDock.shrink}
			{dockShrunk}
			cwd={panes.cwd}
			pdfPaneOpen={layout.pdfPaneOpen && !layout.pdfPopout}
			bind:view={dockView}
			bind:dock={termDock.dock}
			onStartResize={termDock.startResize}
			onResizeByKey={termDock.resizeByKey}
			onToggleShrink={actions.toggleTerminalShrink}
			onClose={actions.toggleTerminal}
			onProblemJump={actions.openFileAt}
			comments={panes.comments}
			commentFile={panes.commentFile}
			commentsOrphaned={panes.commentsOrphaned}
			commentsNotVisible={panes.commentsNotVisible}
			commentFilesPresent={panes.commentFilesPresent}
			commentSelected={panes.commentSelected}
			onCommentOpen={actions.openComment}
			onCommentReply={actions.replyToComment}
			onCommentResolve={actions.resolveComment}
			onCommentDelete={actions.deleteComment}
			onCommentEditMessage={actions.editCommentMessage}
			onCommentDeleteMessage={actions.deleteCommentMessage}
			commentPending={panes.commentPending}
			onCommentSubmitPending={actions.submitComment}
			onCommentCancelPending={actions.cancelComment}
		/>
	{/if}

	{#if (termDock.available || guest) && !termDock.visible}
		<!-- the dock's divider, left behind at the foot of the window when the dock is put away, so
		     dragging it back up reopens it. Outside the `mounted` gate above on purpose: the rail is
		     the way in, and it has to be there before the dock has ever been built.

		     No lozenge, unlike the side rails. Those carry a collapse toggle because their panes lost
		     the toolbar buttons that used to open them; the dock kept both its toolbar button and its
		     menu item, so a control here would only be a third copy. -->
		<!-- eslint-disable-next-line svelte/valid-compile -->
		<div class="bg-surface-200-800 relative z-20 h-px shrink-0" style="grid-row: 4; grid-column: {dockShrunk ? '1' : '1 / -1'}">
			<!-- the grab zone overhangs the rule by 3px, and can only overhang upwards here: below it
			     is the window's edge -->
			<div
				class="hover:bg-primary-500/30 active:bg-primary-500/50 absolute inset-x-0 -inset-y-[3px] cursor-row-resize transition-colors"
				onmousedown={termDock.startResize}
				onkeydown={termDock.resizeByKey}
				role="separator"
				aria-orientation="horizontal"
				aria-label={m.wsview_resize_terminal_aria()}
				tabindex="0"
			></div>
		</div>
	{/if}
</main>
