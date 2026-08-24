<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { navigate } from '$lib/router.svelte';
	import WorkspaceModals from '$lib/modals/workspace/WorkspaceModals.svelte';
	import WorkspaceMain from './WorkspaceMain.svelte';
	import WorkspaceChrome from './WorkspaceChrome.svelte';
	import { compileLog } from '$lib/stores/compileLogStore';
	import { bibPathsFrom } from '$lib/collab/compileIntelBridge';
	import { DraftController } from '$lib/draft/draftController.svelte';
	import GlobalSearch from '$lib/search/GlobalSearch.svelte';
	import TutorialConfirmModal from '$lib/modals/start/TutorialConfirmModal.svelte';
	import { tabs } from '$lib/workspace/tabs.svelte';
	import { docPositions } from '$lib/workspace/docPositions';
	import { WorkspaceNav } from './workspaceNav.svelte';
	import { makeMainActions, makeChromeActions, makePaletteActions, type ActionSurfaceDeps } from './workspaceActionSurfaces';
	import { sourceTocStore } from '$lib/editor/visual/extensions/tableofcontents/tocStore';
	import { parseOutlineRaw, assembleProjectOutline } from '$lib/editor/visual/extensions/tableofcontents/latexHeadings';
	import { refreshProjectIntel } from '$lib/workspace/projectIntel';
	import { projectIntelStore } from '$lib/stores/projectIntel';
	import { setGraphicResolver } from '$lib/languages/latex/intellisense/hover';
	import { graphicCandidateUrls } from '$lib/editor/visual/graphicsCandidates';
	import { setEditorFileAccess } from '$lib/editor/visual/fileAccess';
	import { initSpellcheckConfig } from '$lib/editor/spellcheck/spellcheckConfig';
	import { collabHost } from '$lib/collab/hostStore.svelte';
	import { visualCollabBridge, attachSessionHandlers } from '$lib/collab/workspaceSession';
	import { collabGuest } from '$lib/collab/guestStore.svelte';
	import type { EditSession } from '$lib/collab/editSession';
	import SessionShareModal from '$lib/collab/SessionShareModal.svelte';
	import VisualCollab from '$lib/collab/VisualCollab.svelte';
	import { references } from '$lib/workspace/citations';
	import { pdfStore } from '$lib/stores/pdfStore';
	import { DocRegistries } from '$lib/workspace/docRegistries.svelte';
	import { filePathStore } from '$lib/stores/editorStore';
	import { trailingDebounce } from '$lib/trailingDebounce';
	import { formatTypstDocument, typstBridgeAvailable } from '$lib/languages/typst/intellisense/lspClient';
	import { TypstPreviewController } from '$lib/languages/typst/preview/previewController.svelte';
	import { openGlobalSearch as openSearchPanel, closeGlobalSearch as closeSearchPanel, runFormat } from '$lib/workspace/editorCommands';
	import { WorkspaceComments } from './workspaceComments.svelte';
	import { WorkspaceCompileState } from './workspaceCompileState.svelte';
	import { WorkspaceFiles } from './workspaceFiles.svelte';
	import { WorkspaceDoc } from './workspaceDoc.svelte';
	import { WorkspaceEditFlow } from './workspaceEditFlow.svelte';
	import { projectConfigSync as projectConfig, compileConfig } from '$lib/workspace/projectConfigSync.svelte';
	import { attachWindowListeners, attachCloseGuard } from '$lib/workspace/workspaceMount';
	import { publishWindowState } from '$lib/workspace/mcpPublish';
	import { attachMcpCommands } from '$lib/workspace/mcpCommands';
	import { setPaletteActions } from '$lib/workspace/commandPalette.svelte';
	import { PaneLayout } from '$lib/workspace/paneLayout.svelte';
	import { TerminalDockState } from '$lib/workspace/terminalDockState.svelte';
	import { CompileSettings } from '$lib/workspace/compileSettings.svelte';
	import { createKeydownHandler } from '$lib/workspace/shortcuts';
	import { flattenPaths } from '$lib/workspace/refUpdate';
	import { workspaceRoot, texFiles, fileTree, activeFilePath, isDirty, mainFile, setLastFile } from '$lib/workspace/workspaceStore';
	import { insertCitationFromZotero, zoteroAvailable } from '$lib/zotero/insertFromZotero';
	import ZoteroCitationDialog from '$lib/zotero/ZoteroCitationDialog.svelte';
	import { ScmActions } from '$lib/workspace/scmActions.svelte';
	import { CompilePipeline } from '$lib/workspace/compilePipeline.svelte';
	import { settings } from '$lib/settings';
	import { basename, dirname, claimWorkspace, isDesktop, purgeUndoBackups } from '$lib/workspace/fileSystem';
	import { diskProvider } from '$lib/workspace/diskProvider';
	import type { WorkspaceProvider } from '$lib/workspace/workspaceProvider';
	// the file-access seam: the host gets the disk-backed provider by default; a guest session
	// mounts this same view with a CRDT-backed one. caps gate the host-only features.
	let { provider = diskProvider, session = collabHost }: { provider?: WorkspaceProvider; session?: EditSession } = $props();
	// all file access flows through the provider; these thin delegates keep the existing call sites
	// (and scan's wrapped {root,...} shape) intact
	function readTextFile(p: string) {
		return provider.readText(p);
	}
	function statFile(p: string) {
		return provider.stat(p);
	}
	function fileUrl(p: string) {
		return provider.fileUrl(p);
	}
	function createEntry(p: string, type: 'file' | 'dir', content = '') {
		return provider.create(p, type, content);
	}
	function deleteEntry(p: string) {
		return provider.remove(p);
	}
	function formatLatexDocument(p: string, text: string) {
		return provider.format!(p, text);
	}
	// true for the disk-backed host; false for a read-only guest session. Gates the host-only
	// lifecycle (folder claim, terminal, main-file/macro scan, on-disk change checks) so this same
	// view can run over a shared session.
	const hostMode = $derived(provider.caps.manageTree);
	// tree undo needs somewhere to park a deleted entry AND a way to fetch it back; only the
	// disk-backed provider has both, so a guest session records no file history at all
	const canTrash = $derived(!!provider.trash && !!provider.restore);
	// a guest session: host chrome (compile/terminal/git/file-ops/share) hidden
	const guest = $derived(session.isGuest);
	import { modLabel } from '$lib/platform';
	import { hasVisualMode, isRawTextKind } from '$lib/workspace/documentBuffer.svelte';

	// the open document, its parse/mode lifecycle, and the edit-persistence flow live in
	// ./workspaceDoc.svelte.ts and ./workspaceEditFlow.svelte.ts
	const wsdoc: WorkspaceDoc = new WorkspaceDoc({
		provider,
		session: () => session,
		guest: () => guest,
		visualCollab: () => visualCollab,
		saver: () => editFlow.saver,
		clearStaleGoto: (path) => nav.clearStaleGoto(path)
	});
	const editFlow: WorkspaceEditFlow = new WorkspaceEditFlow({ provider, session: () => session, guest: () => guest, wsdoc });
	const { doc, parser, modes, diff } = wsdoc;
	const { saver, unsaved, external } = editFlow;
	const sourceHistory = modes.history;
	function setViewMode(mode: 'visual' | 'source' | 'diff') {
		return modes.set(mode);
	}
	function captureDiffSnapshot() {
		return diff.snapshot();
	}
	function save() {
		return doc.save();
	}

	// review-comment wiring (controller + feeding effects) lives in ./workspaceComments.svelte.ts
	const commentsW = new WorkspaceComments({
		doc,
		modes,
		kind: () => kind,
		guest: () => guest,
		jumpToFileLine: (abs, line) => nav.syncJumpToFileLine(abs, line)
	});
	const commentsCtl = commentsW.ctl;

	const folderEmpty = $derived($texFiles.length === 0);

	const kind = $derived(doc.kind);
	// a guest opening a text-looking file the host shares as name only (too large / extension the
	// session doesn't sync): say so instead of rendering a silently empty editor
	const nameOnly = $derived(guest && (hasVisualMode(kind) || isRawTextKind(kind)) && session.sharedKindOf(doc.path) === 'binary');

	// live/draft mode isn't supported in a shared session: guests can't run the incremental engine,
	// they see the host's compiled PDF. Force it off while hosting (the toggle is disabled there too).
	$effect(() => {
		if (session.active && !guest && $compileConfig.latex.liveMode) projectConfig.setLiveMode($workspaceRoot, false);
	});
	/**
	 * Typst's Preview does NOT go dark while hosting, unlike draft mode above: the preview's data
	 * plane is relayed to guests over the session (see collab/previewRelay.svelte.ts), so a hosted
	 * preview is exactly what guests watch. The relay also creates demand of its own - a guest can
	 * ask for the stream while the host's pane is closed - which is why the attach effect below
	 * folds previewRelay.demand into `want`.
	 */
	const typstPreviewAvailable = $derived($compileConfig.typst.preview);

	// tree ops, starters, folder lifecycle, main-file choice and rename repointing live in
	// ./workspaceFiles.svelte.ts
	const files = new WorkspaceFiles({
		provider,
		session: () => session,
		doc,
		modes,
		kind: () => kind,
		hostMode: () => hostMode,
		canTrash: () => canTrash,
		layout: () => layout,
		compiler: () => compiler,
		saver: () => saver,
		releaseHeldDraftCompile: () => draftCtl.trigger++,
		typstProject: () => cc.typstProject,
		commentsFileMoved: (from, to) => void commentsCtl.fileMoved(from, to),
		confirmLeaveUnsaved: () => editFlow.confirmLeaveUnsaved(),
		setProjectMacros: (macros) => (wsdoc.projectMacros = macros),
		rebuildVisual: () => wsdoc.rebuildVisualFromSource(),
		resetTerminals: () => resetTerminalsForWorkspace()
	});

	// no folder open (e.g. hard navigation): send the user back to the start screen
	onMount(() => {
		const root = get(workspaceRoot);
		if (!root) {
			navigate('/');
			return;
		}
		// register as this folder's window (covers reloads); a lost claim means another window
		// already owns the folder - that window was focused, this one goes back to Start.
		// a guest session owns no folder, so it neither claims nor sets up a terminal/main file.
		if (hostMode) {
			void claimWorkspace(root).then((c) => {
				if (!c.ok && get(workspaceRoot) === root) {
					workspaceRoot.set(null);
					navigate('/');
				}
			});
			files.mainPrompt.resolve(root); // storage first, before anything can want a compile
			// Nothing can reach the last session's undo backups: the stack is memory-only, so they
			// became unreachable when the window closed. Purging on open (rather than on close) also
			// means they outlive a crash, and the files themselves are in the recycle bin regardless.
			void purgeUndoBackups(root).catch(() => {});
			void files.folder.initProject(root);
		}
		tabs.bind(root, hostMode); // restore this folder's open tabs (guests start fresh)
		docPositions.bind(root, hostMode); // and where the caret was in each of them
		termDock.available = isDesktop() && hostMode; // client-only; set here so SSR/CSR agree
		if (guest) layout.pdfPaneOpen = true; // guests land with the host's PDF visible
		files.loadRefs(root);
		void files.refreshTree();
		initSpellcheckConfig(); // seed editorConfigStore so the spell-check toggle works

		layout.restore(); // loadExistingPdf refills the preview if it was open last
		termDock.restore();
		modes.restore();
		diff.restoreLayout();

		function reloadReferences() {
			const r = get(workspaceRoot);
			if (r) void files.loadRefs(r);
		}
		const detachListeners = attachWindowListeners({
			refreshTree: () => void files.refreshTree(),
			reloadReferences,
			isHost: () => hostMode,
			checkExternalChange: () => void external.check(),
			runCompile: () => compiler.runCompile(),
			onWindowResize: layout.reclampPdf,
			reloadProjectState: () => {
				// both live in .texpile/ and both are committed, so both arrive by pull
				void commentsCtl.refresh();
				void projectConfig.refresh(guest ? null : get(workspaceRoot)).then(() => {
					cc.resolveNow();
				});
			}
		});
		const offBeforeClose = attachCloseGuard({
			promptIsOpen: () => !!unsaved.prompt,
			canCloseSilently: () => editFlow.autosaveActive() || !doc.path || saver.pending?.path !== doc.path,
			flushSaves: () => saver.flushAndWait(),
			confirmLeaveUnsaved: () => editFlow.confirmLeaveUnsaved()
		});
		return () => {
			offBeforeClose?.();
			detachListeners();
			compiler.dispose();
			saver.cancelTimer();
			deferredSourceToc.cancel();
			draftCtl.dispose();
		};
	});

	// Keep main's cache of what this window shows current, for the MCP get_editor_state tool.
	//
	// The dependencies have to be named HERE. buildWindowState reads every one of them with get(),
	// which is the deliberately non-reactive store read - it subscribes and unsubscribes on the spot
	// and never registers a dependency. So this used to track modes.mode alone, and the cache froze:
	// set_main_file left mainFile null for the rest of the session, and `dirty` went stale after an
	// edit even though the server's own instructions tell agents to check it before overwriting a
	// file. publishWindowState de-dupes identical payloads, so listing these costs nothing.
	$effect(() => {
		void $mainFile;
		void $activeFilePath;
		void $isDirty;
		void $settings;
		void tabs.list;
		publishWindowState(modes.mode);
	});

	// the MCP tools that need this window: get_unsaved / get_diagnostics answer here, and the steer
	// commands (open_file, show_diff, set_view_mode) run through the same paths the UI uses
	onMount(() =>
		attachMcpCommands({
			getLoadedPath: () => doc.path,
			getBuffer: () => doc.buffer,
			openFile: (abs) => activeFilePath.set(abs),
			openFileAtLine: (abs, line) => nav.openFileAtLine(abs, line),
			showDiff: () => setViewMode('diff'),
			setViewMode,
			getViewMode: () => modes.mode,
			syncToLine: (line) => nav.syncToLine(line),
			runCompile: () => compiler.runCompile(),
			setMainFile: (abs) => files.applyMainFile(abs),
			isCompiling: () => compiler.busy,
			getCompileCommand: () => cc.command,
			// deferred through compileSettings so an MCP change persists exactly the way the dialog's
			// Save does - folder command, global default, folder output overrides
			applyCompile: (command, outputs) => compileSettings.applyCommand(command, outputs)
		})
	);

	let tutorialModalOpen = $state(false);

	// $state (not const) because descendants bind into these objects' fields: svelte needs an
	// assignable, reactive target to keep the ownership chain intact. Class instances are not
	// proxied by $state, so the objects themselves behave exactly as they would unwrapped.
	let layout = $state(new PaneLayout());

	// visual TOC reads PM headings (works for md too); source-mode TOC parses raw LaTeX, tex-only
	const showToc = $derived(!!doc.path && (modes.mode === 'visual' ? hasVisualMode(kind) : modes.mode === 'source' && kind === 'tex'));
	// source mode has no ProseMirror plugin to feed the outline, so parse headings from the raw
	// .tex; \input fragments pre-scanned into projectIntel merge into one numbered project outline.
	// debounced (display-only) and reading state LIVE at fire time, so typing never pays the parse.
	const deferredSourceToc = trailingDebounce<void>(300, () => {
		if (kind !== 'tex' || modes.mode !== 'source') return;
		sourceTocStore.set(
			assembleProjectOutline(
				parseOutlineRaw(doc.texSource),
				doc.path,
				doc.path ? dirname(doc.path) : null,
				get(workspaceRoot),
				get(projectIntelStore).outlines
			)
		);
	});
	$effect(() => {
		void doc.texSource;
		void $projectIntelStore;
		if (kind === 'tex' && modes.mode === 'source') deferredSourceToc();
	});
	// dock visibility/height/shrink live in lib/workspace/terminalDockState.svelte.ts
	let termDock = $state(new TerminalDockState(() => guest));
	function showTerminal() {
		return termDock.show();
	}
	function resetTerminalsForWorkspace() {
		return termDock.resetForWorkspace();
	}

	let formatModalOpen = $state(false);
	let formatting = $state(false);
	/**
	 * The bottom dock is confined to the editor column rather than spanning every column.
	 *
	 * True when the user asked for it (shrink, which only means anything beside an open preview),
	 * and true whenever the preview is CLOSED - because the column its divider left behind is no
	 * longer zero-width. It holds the rail that reopens the pane, so a dock spanning to the last
	 * column now runs straight past that rail to the window edge.
	 */
	// popped out counts as "no docked pane": the rail is up and the dock must not run past it
	const dockShrunk = $derived(termDock.shrink || !layout.pdfPaneOpen || layout.pdfPopout);
	// bottom dock body: the terminal shells (always mounted) or the Problems list
	let dockView = $state<'terminal' | 'problems' | 'comments'>('terminal');
	// the resolved compile command and its follower effects live in ./workspaceCompileState.svelte.ts
	const cc: WorkspaceCompileState = new WorkspaceCompileState({
		doc,
		guest: () => guest,
		session: () => session,
		compiler: () => compiler,
		typstPreview: () => typstPreview,
		statFile
	});

	// Draft mode, whole: root/main derivation, triggers, pause, the per-edit dispatcher, and
	// the engine lifecycle live in the controller; the preview chain gets this ONE object.
	const draftCtl: DraftController = new DraftController({
		compileCommand: () => cc.command,
		// hold the first live compile until the main file is confirmed
		mainConfirmed: () => files.mainPrompt.confirmed === true,
		pdfPaneOpen: () => layout.pdfPaneOpen,
		setPdfPaneOpen: (open) => layout.setPdfPaneOpen(open),
		openCompileModal: () => openCompileModal(),
		getSource: () => doc.texSource,
		getLoadedPath: () => doc.path,
		flushSaves: () => saver.flushAndWait()
	});
	files.draftPaused = () => draftCtl.paused;
	// the Compile button doubles as the draft status (live / paused)
	function runDraftCompile() {
		return draftCtl.compile();
	}
	// a new folder starts blank: the previous folder's log, PDF and macros are meaningless here
	// (the switch now flips the root before its scan, so these would otherwise linger on screen)
	$effect(() => {
		void $workspaceRoot; // dependency: re-run per folder
		compileLog.set(null);
		pdfStore.set(null); // initProject's loadExistingPdf refills it for the new folder
		wsdoc.projectMacros = '';
		dockView = 'terminal';
		compiler.resetForFolder(); // any pollers still watching the previous folder's paths stand down
		cc.resolveNow();
	});
	// the Typst live preview, whole: task lifecycle, caret follow, forward sync, the guest
	// stream relay, and its Problems feed live in languages/typst/preview/previewController.svelte.ts
	const typstPreview: TypstPreviewController = new TypstPreviewController({
		getGuest: () => guest,
		getMainFile: () => $mainFile,
		getPreviewSwitchOn: () => typstPreviewAvailable,
		getTexFileCount: () => $texFiles.length,
		getPaneOpen: () => layout.pdfPaneOpen,
		setPaneOpen: (open) => layout.setPdfPaneOpen(open),
		setPreviewSwitch: (root, on) => projectConfig.setTypstPreview(root, on),
		getDocPath: () => doc.path,
		getFollow: () => $settings.typstPreviewFollow === true,
		getCompileCommand: () => cc.command,
		getVisualCaretSourcePos: (): { line: number; character: number } | null => nav.visualCaretSourcePos(),
		flushSaves: () => saver.flushAndWait(),
		refreshTree: () => files.refreshTree(),
		syncJumpToFileLine: (file: string, line: number) => nav.syncJumpToFileLine(file, line)
	});

	// compile / terminal / PDF-watch orchestration lives in lib/workspace/compilePipeline.svelte.ts
	const compiler: CompilePipeline = new CompilePipeline({
		getLoadedPath: () => doc.path,
		getCompileCommand: () => cc.command,
		terminalAvailable: () => termDock.available,
		mainConfirmed: () => files.mainPrompt.confirmed,
		commandPending: () => !!projectConfig.pending,
		getSession: () => session,
		getDock: () => termDock.dock,
		stat: statFile,
		readText: readTextFile,
		create: createEntry,
		fileUrl,
		flushSaves: () => saver.flushAndWait(),
		refreshTree: () => files.refreshTree(),
		showTerminal,
		setDockView: (v) => (dockView = v),
		setPdfPaneOpen: (open: boolean) => layout.setPdfPaneOpen(open),
		openCompileModal: () => openCompileModal(),
		openMainConfirm: (then) => void files.mainPrompt.prompt(then),
		runDraftCompile,
		openTypstPreview: () => typstPreview.enable(),
		shareCompileState: () => cc.share()
	});

	// every jump route (SyncTeX forward/inverse, visual caret mapping, include targets, the PDF
	// pane scroll plumbing) lives in ./workspaceNav.svelte.ts
	const nav: WorkspaceNav = new WorkspaceNav({
		doc,
		modes,
		kind: () => kind,
		guest: () => guest,
		setPdfPaneOpen: (open) => layout.setPdfPaneOpen(open),
		getDraftRoot: () => draftCtl.root,
		syncDraftTo: (page, x, y, w, h) => draftCtl.view?.syncTo(page, x, y, w, h),
		expectedPdfPath: () => compiler.expectedPdfPath(),
		typstSyncForward: () => typstPreview.syncForward(),
		typstSyncToLine: (line) => typstPreview.syncToLine(line),
		statFile
	});

	// Zotero citations (host-only; see lib/zotero)
	// The open file's dialect must match the main's engine: the imported entries land in the
	// bibliography the MAIN file declares, so a .typ scratch file open in a LaTeX project has
	// nowhere sensible to point its citation.
	// zoteroEnabled gates every entry point (editor context menu, command palette) through this one predicate
	function canZoteroCite() {
		return (
			$settings.zoteroEnabled !== false &&
			!guest &&
			zoteroAvailable() &&
			!!$mainFile &&
			(typstPreview.mainIsTypst ? kind === 'typ' : kind === 'tex')
		);
	}
	function insertZoteroCitation() {
		if (!canZoteroCite()) return;
		void insertCitationFromZotero({
			kind: kind as 'tex' | 'typ',
			root: get(workspaceRoot) ?? '',
			openDoc: () => ({ path: doc.path, text: doc.buffer })
		});
	}

	// compile-command dialog state lives in lib/workspace/compileSettings.svelte.ts
	let compileSettings = $state(
		new CompileSettings(
			() => cc.command,
			(c) => (cc.command = c),
			() => compiler.runCompile()
		)
	);
	/**
	 * Everything in the modal - the Format readout, which lane's settings show, the default
	 * command - derives from the main file, so opened without one it can only show the LaTeX
	 * fallback, which for a Typst folder is wrong on every row. Ask for the main first and open
	 * the modal after; even dismissing the picker settles the detected candidate, so what follows
	 * shows a real lane. An empty folder skips straight in - there is nothing to pick - and a
	 * guest has no main file to set (compiling is the host's).
	 */
	function openCompileModal() {
		if (hostMode && !get(mainFile) && get(texFiles).length > 0 && !files.mainPrompt.open) {
			void files.mainPrompt.prompt(() => compileSettings.open());
			return;
		}
		compileSettings.open();
	}
	function saveCompileCommand(thenRun: boolean) {
		return compileSettings.save(thenRun);
	}
	function useDefaultCommand() {
		return compileSettings.useDefault();
	}

	/**
	 * Whether Format can serve the open file. LaTeX goes through latexindent (an external tool the
	 * provider must expose); Typst goes through tinymist's built-in typstyle, gated to SOURCE mode:
	 * the formatter edits the server's in-memory document, and only the source editor's LSP binding
	 * keeps that identical to the buffer - in visual mode the server's copy is stale or closed.
	 */
	function canFormatDoc(): boolean {
		if (kind === 'tex') return provider.caps.format;
		return kind === 'typ' && typstBridgeAvailable() && modes.mode === 'source';
	}
	function openFormatModal() {
		if (!doc.path || !canFormatDoc()) return;
		formatModalOpen = true;
	}
	function doRunFormat() {
		formatModalOpen = false;
		return runFormat({
			getLoadedPath: () => doc.path,
			getSource: () => doc.texSource,
			getEol: () => doc.eol,
			flushSaves: () => saver.flushAndWait(),
			format: kind === 'typ' ? (p, text) => formatTypstDocument(get(workspaceRoot), p, text) : formatLatexDocument,
			applyFormatted: (text) => doc.replaceSource(text, { dirty: true }),
			setBusy: (b) => (formatting = b)
		});
	}
	// label and bibitem registries live in lib/workspace/docRegistries.svelte.ts
	const registries = new DocRegistries({
		getSource: () => doc.texSource,
		captureHistory: (text) => sourceHistory.capture(text)
	});
	const allReferences = $derived.by(() => {
		void $references; // re-derive when the folder's .bib entries change
		return registries.merged;
	});
	$effect(() => registries.publish(allReferences));

	$effect(() => {
		const tree = $fileTree;
		const root = $workspaceRoot;
		filePathStore.set(root ? flattenPaths(tree, root) : []);
	});

	// remember the open file per folder so reopening the workspace restores it (StartView's
	// initialFile); recorded on every switch, kept when the file later disappears (existence is
	// checked at restore time)
	$effect(() => {
		const root = $workspaceRoot;
		const path = $activeFilePath;
		if (root && path) setLastFile(root, path);
	});

	// cross-file intel (labels/defs/glossary/outlines/aux numbers from the OTHER project files):
	// rescan when the file list, main file, or active file changes — those are the only times the
	// non-active files' on-disk state can have moved under us (a switch flushes the previous save)
	$effect(() => {
		const files = $texFiles;
		const main = $mainFile;
		const active = $activeFilePath;
		const tree = $fileTree;
		const root = $workspaceRoot;
		const bibs = root ? bibPathsFrom(flattenPaths(tree, root), root) : [];
		// the .aux sits next to the log (output/aux dirs included); fall back to a main-sibling .aux
		const aux = compiler.expectedLogPath()?.replace(/\.log$/i, '.aux') ?? (main ? main.replace(/\.tex$/i, '.aux') : null);
		// a guest has no aux on disk; the host's shared parse fills the numbers in (and re-runs
		// this when a fresh compile lands). Reading session.active also seeds the host's share
		// when a session starts against an already-compiled project.
		const live = session.active;
		const sharedAux =
			guest && session.compileIntel ? { numbers: session.compileIntel.auxNumbers, pages: session.compileIntel.auxPages } : null;
		void refreshProjectIntel(files, bibs, guest ? null : aux, active ?? null, readTextFile, sharedAux).then(() => {
			if (live && !guest) cc.share();
		});
	});

	// \includegraphics hover preview: candidate texfile:// URLs (current dir, root, and any
	// \graphicspath dirs, adding raster extensions when the path has none); the tooltip's img
	// advances past misses
	// the visual editor's shared-session machinery (remote patches, presence) lives in
	// VisualCollab; this api hands it doc-state access, the ref carries its editor hooks
	let visualCollab = $state<{ noteLocalEdit(): void; noteFreshParse(): void; publishCursor(): void } | null>(null);
	const visualCollabApi = visualCollabBridge({
		doc,
		parser,
		parse: (text) => wsdoc.tryParseVisual(text),
		scheduleSave: (path, content) => saver.schedule(path, content)
	});

	// visual-editor file access (figure previews, image paste) resolves through the provider,
	// so a guest's images come from the session blob cache and uploads go through the session
	setEditorFileAccess(
		(p) => provider.fileUrl(p),
		(p, blob) => provider.writeBinary(p, blob)
	);
	setGraphicResolver((rel) =>
		graphicCandidateUrls(rel, { root: get(workspaceRoot), loadedPath: doc.path, source: doc.texSource, fileUrl })
	);
	onDestroy(() => {
		setGraphicResolver(null);
		setEditorFileAccess(null, null);
		typstPreview.dispose(); // leaving the workspace must not leave a preview compiling in the server
		projectConfig.reset(); // adopted compile state is per folder; the start screen holds defaults
	});

	// shared session: guests can ask for a compile; leaving the workspace ends the session
	let shareModalOpen = $state(false);
	onMount(() =>
		attachSessionHandlers(session, {
			runCompile: () => void compiler.runCompile(),
			isBusy: () => compiler.busy,
			refreshTree: () => void files.refreshTree(),
			expectedPdfPath: () => compiler.expectedPdfPath(),
			applyCommentEvent: (event) => void commentsCtl.ingest(event),
			commentLog: () => commentsCtl.store.serialize(),
			typstScrollForGuest: (rel, line, character) => typstPreview.scrollForGuest(rel, line, character)
		})
	);

	// keep the label registry, the embedded bibitem refs, and the cross-mode undo history fresh
	$effect(() => {
		void doc.texSource; // dependency: re-arm the debounce on every source change
		return registries.schedule();
	});

	// source control ops live in lib/workspace/scmActions.svelte.ts; the panel is presentational.
	const scm = new ScmActions({
		getLoadedPath: () => doc.path,
		discardPendingSave: () => saver.discard(),
		deleteEntry,
		refreshTree: () => files.refreshTree(),
		loadFile: (path) => wsdoc.loadFile(path),
		captureDiffSnapshot: () => void captureDiffSnapshot(),
		isDiffMode: () => modes.mode === 'diff',
		enterDiffMode: () => (modes.mode = 'diff')
	});

	let globalSearchRef = $state<GlobalSearch | null>(null);
	// Find in Files panel plumbing lives in lib/workspace/editorCommands.ts
	const searchDeps = {
		setSidebarView: (v: 'explorer' | 'search' | 'scm') => (layout.sidebarView = v),
		openSidebar: () => (layout.sidebarOpen = true),
		isSourceMode: () => modes.mode === 'source',
		focusInput: (seed?: string) => globalSearchRef?.focusInput(seed)
	};
	function openGlobalSearch() {
		return openSearchPanel(searchDeps);
	}
	function closeGlobalSearch() {
		return closeSearchPanel(searchDeps);
	}

	// the three callback surfaces live in ./workspaceActionSurfaces.ts
	const actionDeps: ActionSurfaceDeps = {
		doc,
		modes,
		commentsCtl,
		termDock: () => termDock,
		layout: () => layout,
		draftCtl,
		typstPreview,
		compiler,
		nav,
		starters: files.starters,
		provider,
		kind: () => kind,
		guest: () => guest,
		typstProject: () => cc.typstProject,
		visualCollab: () => visualCollab,
		setDockView: (v) => (dockView = v),
		setShareModalOpen: (open) => (shareModalOpen = open),
		setTutorialModalOpen: (open) => (tutorialModalOpen = open),
		setViewMode,
		save: () => save(),
		captureDiffSnapshot: () => void captureDiffSnapshot(),
		activateTab: (p) => editFlow.activateTab(p),
		closeTab: (p) => editFlow.closeTab(p),
		newFileOfType: (ext) => files.newFileOfType(ext),
		openFolderFromMenu: (path) => void files.folder.open(path),
		closeWorkspace: () => void files.folder.close(),
		openCompileModal,
		openFormatModal,
		canFormatDoc,
		openGlobalSearch: () => void openGlobalSearch(),
		closeGlobalSearch: () => void closeGlobalSearch(),
		toggleMainFile: (p) => void files.toggleMainFile(p),
		refreshTree: () => files.refreshTree(),
		canZoteroCite,
		insertZoteroCitation,
		setCompileCommandResolved: () => cc.resolveNow(),
		openEntry: (entry) => files.openEntry(entry),
		statFile
	};
	const actions = makeMainActions(actionDeps);
	const chromeActions = makeChromeActions(actionDeps);

	// the Ctrl+K palette. Registered rather than passed down: it reaches roughly a dozen of these
	// actions, and threading that through WorkspaceChrome and WorkspaceMain to a dialog would touch
	// four files per command. Cleared on destroy so a keystroke after the workspace closed is inert.
	onMount(() => {
		setPaletteActions(makePaletteActions(actionDeps));
		return () => setPaletteActions(null);
	});

	const uiZoomPercent = $derived(Math.round(($settings.uiZoom ?? 1) * 100));
	// shortcut table + UI zoom live in lib/workspace/shortcuts.ts
	const onKeydown = createKeydownHandler({
		getLoadedPath: () => doc.path,
		closeTab: (p: string) => editFlow.closeTab(p),
		isGuest: () => guest,
		save,
		openGlobalSearch: () => void openGlobalSearch(),
		terminalAvailable: () => termDock.available,
		isCompiling: () => compiler.compiling,
		runCompile: () => compiler.runCompile(),
		stopCompile: () => compiler.stopCompile()
	});
</script>

<svelte:window onkeydown={onKeydown} />
<!-- file - folder - app (VS Code's order); the folder segment tells windows apart in the taskbar -->
<svelte:head
	><title>{$workspaceRoot ? `${doc.path ? `${basename(doc.path)} - ` : ''}${basename($workspaceRoot)} - Texpile` : 'Texpile'}</title
	></svelte:head
>

<div class="flex h-screen flex-col overflow-hidden">
	<WorkspaceChrome
		bind:layout
		{modes}
		bind:termDock
		{compiler}
		{scm}
		treeOps={files.treeOps}
		{guest}
		{modLabel}
		{showToc}
		menu={{
			disabled: !doc.path,
			fileKind: kind,
			// an image is written next to the document, so a workspace that takes no tree writes has
			// nowhere to put one however good the path looks
			imageDir: hostMode && doc.path && hasVisualMode(kind) ? dirname(doc.path) : undefined,
			// never a guest: a guest is IN someone's session, not in a position to open one
			shareable: isDesktop() && !guest,
			hostMode,
			canFormat: canFormatDoc(),
			uiZoomPercent,
			typstProject: cc.typstProject
		}}
		actions={chromeActions}
		pendingCommand={projectConfig.pending}
		bind:fileTreeRef={files.fileTreeRef}
		bind:globalSearchRef
	>
		<WorkspaceMain
			{doc}
			{modes}
			{layout}
			{diff}
			{parser}
			{termDock}
			{compiler}
			{saver}
			{session}
			{guest}
			{kind}
			{nameOnly}
			{folderEmpty}
			{modLabel}
			{dockShrunk}
			draft={draftCtl}
			typstPreviewHost={typstPreview.host}
			typstPreviewWanted={typstPreview.wanted}
			mainIsTypst={typstPreview.mainIsTypst}
			guestTypstOffered={guest && collabGuest.typstPreviewOffered}
			mainUnset={typstPreview.mainUnset}
			onPickMain={() => void files.mainPrompt.prompt()}
			panes={{
				openTabs: tabs.list,
				previewTab: tabs.preview,
				applyingStarter: files.starters.applying,
				allReferences,
				sourceGotoLine: nav.sourceGotoLine,
				sourceDiagnostics: cc.sourceDiagnostics,
				fileUrl,
				cwd: $workspaceRoot ?? '',
				comments: commentsCtl.threads,
				commentFile: commentsCtl.activeFile,
				commandPending: !!projectConfig.pending,
				commentsOrphaned: commentsCtl.orphaned,
				commentsNotVisible: commentsCtl.notVisible,
				commentFilesPresent: commentsW.filesPresent,
				commentSelected: commentsCtl.selected,
				commentRanges: commentsCtl.ranges,
				commentPending: commentsCtl.pending,
				zoteroCite: canZoteroCite()
			}}
			{actions}
			bind:dockView
			bind:pdfPaneRef={nav.pdfPaneRef}
		/>
	</WorkspaceChrome>

	<ZoteroCitationDialog />

	<WorkspaceModals
		bind:mainPrompt={files.mainPrompt}
		{unsaved}
		{external}
		bind:compileSettings
		bind:formatModalOpen
		formatTool={kind === 'typ' ? 'typstyle' : 'latexindent'}
		{formatting}
		pendingRefUpdate={files.pendingRefUpdate}
		onSaveCompile={saveCompileCommand}
		onUseDefaultCompile={useDefaultCommand}
		onRunCompile={compiler.runCompile}
		onFormat={doRunFormat}
		onResolveConflict={(c) => external.resolve(c)}
		onKeepRefs={() => (files.pendingRefUpdate = null)}
		onApplyRefs={() => void files.applyPendingRefUpdate()}
	/>
</div>

<TutorialConfirmModal bind:open={tutorialModalOpen} onConfirm={(root) => void files.folder.openTutorial(root)} />
{#if !guest}
	<SessionShareModal bind:open={shareModalOpen} root={$workspaceRoot} onBeforeStart={() => saver.flushAndWait()} />
{/if}
{#if session.active}
	<VisualCollab bind:this={visualCollab} {session} path={doc.path} {kind} viewMode={modes.mode} api={visualCollabApi} />
{/if}
