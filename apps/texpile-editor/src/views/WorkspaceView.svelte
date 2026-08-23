<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { navigate } from '$lib/router.svelte';
	import WorkspaceModals from '$lib/editor/comp/WorkspaceModals.svelte';
	import WorkspaceMain from '$lib/editor/comp/WorkspaceMain.svelte';
	import WorkspaceChrome from '$lib/editor/comp/WorkspaceChrome.svelte';
	import { type RefUpdate } from '$lib/editor/comp/RefUpdateModal.svelte';
	import { compileLog } from '$lib/stores/compileLogStore';
	import {
		shareCompileState as shareHostCompileState,
		bibPathsFrom,
		guestCompileLog,
		guestDiagnosticsFor,
		hostDiagnosticsFor
	} from '$lib/collab/compileIntelBridge';
	import { DraftController } from '$lib/draft/draftController.svelte';
	import GlobalSearch from '$lib/editor/comp/GlobalSearch.svelte';
	import TutorialConfirmModal from '$lib/editor/comp/TutorialConfirmModal.svelte';
	import type { Starter, ImportedFile } from '$lib/workspace/starters';
	import { StarterActions } from '$lib/workspace/starterActions.svelte';
	import { editorViewStore } from '$lib/stores/editorStore';
	import { revealPmComment } from '$lib/editor/extensions/pmComments';
	import { tabs } from '$lib/workspace/tabs.svelte';
	import { docPositions } from '$lib/workspace/docPositions';
	import { SyncTexNav, sessionRelativeTarget, needsActivate, normSyncPath } from '$lib/workspace/syncTexNav';
	import { sourceTocStore } from '$lib/editor/extensions/tableofcontents/tocStore';
	import { parseOutlineRaw, assembleProjectOutline } from '$lib/editor/extensions/tableofcontents/latexHeadings';
	import { refreshProjectIntel } from '$lib/workspace/projectIntel';
	import { projectIntelStore } from '$lib/stores/projectIntel';
	import { setGraphicResolver } from '$lib/editor/extensions/intellisense/hover';
	import { graphicCandidateUrls } from '$lib/editor/graphicsCandidates';
	import { setEditorFileAccess } from '$lib/editor/fileAccess';
	import { initSpellcheckConfig } from '$lib/editor/extensions/spellcheck/spellcheckConfig';
	import { collabHost } from '$lib/collab/hostStore.svelte';
	import { isSafeRel } from '$lib/collab/protocol';
	import { previewRelay } from '$lib/collab/previewRelay.svelte';
	import { updateLayout } from '$lib/storage/layout';
	import { users } from '$lib/storage/users';
	import { visualCollabBridge, attachSessionHandlers } from '$lib/collab/workspaceSession';
	import { collabGuest } from '$lib/collab/guestStore.svelte';
	import type { EditSession } from '$lib/collab/editSession';
	import SessionShareModal from '$lib/collab/SessionShareModal.svelte';
	import VisualCollab from '$lib/collab/VisualCollab.svelte';
	import { references, loadReferences } from '$lib/workspace/citations';
	import { pdfStore } from '$lib/stores/pdfStore';
	import { DocRegistries } from '$lib/workspace/docRegistries.svelte';
	import { filePathStore } from '$lib/stores/editorStore';
	import { sourceCmView } from '$lib/stores/editorStore';
	import { trailingDebounce } from '$lib/trailingDebounce';
	import { buildBlockMap, pmPosToSourceOffset, firstWordEndOnLine } from '$lib/editor/sourceMap';
	import {
		startTypstPreview,
		killTypstPreview,
		formatTypstDocument,
		typstBridgeAvailable,
		tinymistResolved,
		setPreviewJumpHandler,
		setTypstDiagnosticsHandler,
		scrollTypstPreview,
		exportTypstPdf,
		typstServerGen,
		type TypstDiagnostic
	} from '$lib/typst/lspClient';
	import { noteFollowScroll } from '$lib/typst/preview/followSignal';
	import type { LogEntry } from '$lib/latex-log';
	import {
		openGlobalSearch as openSearchPanel,
		closeGlobalSearch as closeSearchPanel,
		runFormat,
		insertIncludeAtCursor,
		insertTypstIncludeAtCursor,
		jumpToInclude as jumpToIncludeTarget
	} from '$lib/workspace/editorCommands';
	import { DiffMode } from '$lib/workspace/diffMode.svelte';
	import { CommentsController } from '$lib/workspace/commentsController.svelte';
	import { projectConfigSync as projectConfig, compileConfig } from '$lib/workspace/projectConfigSync.svelte';
	import type { CommentMessage, CommentThread } from '$lib/comments/log';
	import type { CommentAnchor } from '$lib/comments/anchor';
	import { attachWindowListeners, attachCloseGuard } from '$lib/workspace/workspaceMount';
	import { ViewModeSwitch } from '$lib/workspace/viewModeSwitch.svelte';
	import { saveVisualPosition, restoreVisualPosition } from '$lib/workspace/visualPositions';
	import { stripTypst } from '$lib/typst/visual/sourceMap';
	import { bodyOffsetOf } from '$lib/workspace/latexRoundtrip';
	import { publishWindowState } from '$lib/workspace/mcpPublish';
	import { attachMcpCommands } from '$lib/workspace/mcpCommands';
	import { setPaletteActions } from '$lib/workspace/commandPalette.svelte';
	import { preferencesOpen, openToolchainPrefs } from '$lib/stores/dialogStore';
	import { PaneLayout } from '$lib/workspace/paneLayout.svelte';
	import { TerminalDockState } from '$lib/workspace/terminalDockState.svelte';
	import { CompileSettings } from '$lib/workspace/compileSettings.svelte';
	import { ExternalChangeWatcher } from '$lib/workspace/externalChange.svelte';
	import { FolderLifecycle } from '$lib/workspace/folderLifecycle';
	import { UnsavedGuard } from '$lib/workspace/unsavedGuard.svelte';
	import { createKeydownHandler, uiZoomIn, uiZoomOut, uiZoomReset } from '$lib/workspace/shortcuts';
	import { MainFilePrompt } from '$lib/workspace/mainFilePrompt.svelte';
	import { scanRenamedRefs, applyRefUpdate, flattenPaths } from '$lib/workspace/refUpdate';
	import {
		workspaceRoot,
		texFiles,
		fileTree,
		activeFilePath,
		isDirty,
		mainFile,
		setMainFile,
		setLastFile,
		effectiveCompileFormat
	} from '$lib/workspace/workspaceStore';
	import { refreshGitStatus } from '$lib/workspace/gitStore';
	import { insertCitationFromZotero, zoteroAvailable } from '$lib/zotero/insertFromZotero';
	import ZoteroCitationDialog from '$lib/zotero/ZoteroCitationDialog.svelte';
	import { refreshTree as refreshTreeState, flatFiles } from '$lib/workspace/treeRefresh';
	import { relativeTo } from '$lib/comments/store.svelte';
	import { ScmActions } from '$lib/workspace/scmActions.svelte';
	import { SavePipeline } from '$lib/workspace/savePipeline.svelte';
	import { diskChangedSince, recordDiskStamp, retargetDiskStamp } from '$lib/workspace/diskStamp';
	import { CompilePipeline, resolveCompileCommand, relFromRoot } from '$lib/workspace/compilePipeline.svelte';
	import { TreeOps } from '$lib/workspace/treeOps';
	import { settings } from '$lib/settings';
	import { detectMainFile, gatherProjectMacros } from '$lib/workspace/project';
	import {
		basename,
		dirname,
		claimWorkspace,
		isDesktop,
		joinPath,
		samePath,
		revealItem,
		savePdfAs,
		purgeUndoBackups,
		type TreeEntry
	} from '$lib/workspace/fileSystem';
	import { isTypstCommand, typstOutDir } from '$lib/workspace/typstCommand';
	import { diskProvider } from '$lib/workspace/diskProvider';
	import type { WorkspaceProvider } from '$lib/workspace/workspaceProvider';
	// the file-access seam: the host gets the disk-backed provider by default; a guest session
	// mounts this same view with a CRDT-backed one. caps gate the host-only features.
	let { provider = diskProvider, session = collabHost }: { provider?: WorkspaceProvider; session?: EditSession } = $props();
	// all file access flows through the provider; these thin delegates keep the existing call sites
	// (and scan's wrapped {root,...} shape) intact
	const readTextFile = (p: string) => provider.readText(p);
	const writeTextFile = (p: string, content: string) => provider.writeText(p, content);
	const writeBinaryFile = (p: string, data: Blob) => provider.writeBinary(p, data);
	const statFile = (p: string) => provider.stat(p);
	const fileUrl = (p: string) => provider.fileUrl(p);
	const createEntry = (p: string, type: 'file' | 'dir', content = '') => provider.create(p, type, content);
	const deleteEntry = (p: string) => provider.remove(p);
	const renameEntry = (from: string, to: string) => provider.rename(from, to);
	const copyEntry = (from: string, to: string) => provider.copy(from, to);
	const formatLatexDocument = (p: string, text: string) => provider.format!(p, text);
	const scanTexFiles = async (root: string) => ({ root, files: await provider.scanTexFiles(root) });
	// citations read through the provider too, so guest sessions resolve \cite keys from the shared doc
	const loadRefs = (root: string) => loadReferences(root, { scan: (r, e) => provider.scanFiles(r, e), read: readTextFile });
	// true for the disk-backed host; false for a read-only guest session. Gates the host-only
	// lifecycle (folder claim, terminal, main-file/macro scan, on-disk change checks) so this same
	// view can run over a shared session.
	const hostMode = $derived(provider.caps.manageTree);
	// tree undo needs somewhere to park a deleted entry AND a way to fetch it back; only the
	// disk-backed provider has both, so a guest session records no file history at all
	const canTrash = $derived(!!provider.trash && !!provider.restore);
	// a guest session: host chrome (compile/terminal/git/file-ops/share) hidden
	const guest = $derived(session.isGuest);
	// guests never enter diff (no disk/git to diff against); visual is fine, it runs on the
	// shared Y.Text like everything else
	$effect(() => {
		if (guest && modes.mode === 'diff') modes.mode = 'source';
	});
	// guests: resolve the main file + cross-file macro context from the shared doc (the host-only
	// initProject never runs for them), re-gathered when the shared file set changes, so visual
	// parses see the project's custom macro signatures and can't mis-serialize a guest edit
	$effect(() => {
		if (!guest || !session.active) return;
		void session.manifestRev;
		const root = get(workspaceRoot);
		if (!root) return;
		void (async () => {
			try {
				const files = await provider.scanTexFiles(root);
				const main = await detectMainFile(files, provider.readText);
				const macros = main ? await gatherProjectMacros(main, root, provider.readText) : '';
				if (macros === projectMacros) return;
				projectMacros = macros;
				// signatures changed: a doc parsed without them is stale, re-derive the open one
				parser.lastParsedSource = '';
				if (doc.path && kind === 'tex' && modes.mode === 'visual') rebuildVisualFromSource();
			} catch {
				projectMacros = '';
			}
		})();
	});
	import { modLabel } from '$lib/platform';
	import { DocumentBuffer, fileKind, formatOf, hasVisualMode, isRawTextKind } from '$lib/workspace/documentBuffer.svelte';
	import { FileOpener } from '$lib/workspace/fileOpener';
	import { VisualParser, type ParseFailure } from '$lib/workspace/visualParse.svelte';
	import type { Node as PMNode } from 'prosemirror-model';
	import { toaster } from '$lib/modals/toaster-svelte';
	import { m } from '$lib/paraglide/messages';

	// single source of truth for a .tex file: its raw text (doc.texSource), the whole file. the visual
	// editor is a view over it: entry parses into doc.visualDoc + doc.docMeta, every visual edit serializes
	// straight back into doc.texSource, and source mode binds to it directly. no rival copy can drift.
	// mirror to the global store so menuBarCommands can route Insert/Format;
	// diff is read-only, so routing it as source is harmless
	$effect(() => modes.syncStore());

	// diff view (read-only): committed HEAD vs the live buffer, snapshotted (not bound)
	// on entry / file switch / manual refresh so it never re-diffs per keystroke
	// worker parse + sequencing live in lib/workspace/visualParse.svelte.ts
	const parser = new VisualParser(() => projectMacros);
	const tryParseVisual = (text: string) => parser.parse(text, formatOf(kind));

	// the open file's buffers and edit handlers live in lib/workspace/documentBuffer.svelte.ts
	const doc: DocumentBuffer = new DocumentBuffer({
		scheduleSave: (path, content) => saver.schedule(path, content),
		discardQueuedSave: () => saver.discard(),
		writeNow: (path, content, force) => void saver.enqueue(path, content, true, force),
		rebuildVisual: () => rebuildVisualFromSource(),
		isVisualMode: () => modes.mode === 'visual',
		noteLocalEdit: () => visualCollab?.noteLocalEdit(),
		clearPendingAnchor: () => (modes.pendingVisualAnchor = null)
	});

	// view mode, scroll anchors and cross-mode history live in lib/workspace/viewModeSwitch.svelte.ts
	const modes: ViewModeSwitch = new ViewModeSwitch({
		getKind: () => kind,
		getLoadedPath: () => doc.path,
		getSource: () => doc.texSource,
		setSource: (t) => (doc.texSource = t),
		getDocMeta: () => doc.docMeta,
		getLastParsedSource: () => parser.lastParsedSource,
		rebuildVisual: () => rebuildVisualFromSource(),
		captureDiffSnapshot: () => void captureDiffSnapshot(),
		scheduleSave: (path, text) => saver.schedule(path, text)
	});
	const sourceHistory = modes.history;
	const setViewMode = (mode: 'visual' | 'source' | 'diff') => modes.set(mode);
	const exitDiff = () => modes.exitDiff();
	const workspaceHistoryStep = (dir: 'undo' | 'redo') => modes.historyStep(dir);
	// the doc.visualDoc dep re-fires this when an async re-parse lands (the doc swap itself is untracked)
	$effect(() => {
		void $editorViewStore;
		void doc.visualDoc;
		void modes.pendingVisualAnchor;
		void modes.mode;
		modes.tryResolvePendingAnchor();
	});

	// HEAD-vs-working-copy view; state and snapshotting live in lib/workspace/diffMode.svelte.ts
	const diff = new DiffMode({
		getLoadedPath: () => doc.path,
		getWorkingText: () => (hasVisualMode(kind) ? doc.texSource : doc.rawContent)
	});
	const captureDiffSnapshot = () => diff.snapshot();

	/**
	 * The refresh buttons confirm they ran.
	 *
	 * All three do their work silently and usually change nothing visible - the point of pressing one
	 * is that you already suspect the view is stale - so there was no way to tell a working button
	 * from a dead one. Only the BUTTON paths toast: the same refreshes also run on the watcher, on
	 * focus and on session events, and a toast for those would be a notification every few seconds.
	 */
	const toastAfter = async (title: string, work: () => unknown): Promise<void> => {
		await work();
		toaster.success({ title, duration: 1500 });
	};

	// Review comments. The log lives in .texpile/comments.jsonl; anchors are re-resolved whenever a
	// file opens or its text is replaced from outside, never per keystroke - see the controller.
	// .texpile/config.json: the project's own build settings, adopted on open and written back on
	// every change. Its compile command needs accepting once per project - see projectConfig.ts.
	$effect(() => {
		const root = guest ? null : $workspaceRoot;
		// adopt() writes through workspaceStore, which the live compileCommand was ALREADY derived
		// from when the folder opened - so without re-resolving here the config landed in storage
		// and the editor went on using whatever it had worked out before reading the file.
		void projectConfig.adopt(root).then(() => {
			compileCommand = resolveCompileCommand(get(mainFile));
		});
	});

	const commentsCtl = new CommentsController({
		root: () => $workspaceRoot,
		// a guest has no git repo to fall back to (its root is the 'session' sentinel), but it DOES
		// have the name it joined with - that is what every peer already sees on its cursor
		preferredAuthor: () => $users.commentAuthor || (guest ? collabGuest.selfName : ''),
		// new anchors and event resolution read the LIVE buffer; the reanchor snapshot goes stale
		// under remote edits in a shared session (see the controller's activeText comment)
		activeText: () => commentText(),
		// the mode-preserving jump, not openFileAtLine: revealing a comment from the panel must not
		// yank a visual-mode reader into source - the same courtesy SyncTeX inverse clicks get
		openFileAt: (abs, line) => syncJumpToFileLine(abs, line),
		// Preferred over the line jump while the reader is in visual mode: pmComments has the thread's
		// exact range in the rendered document, so this lands ON the highlight instead of at the top of
		// the block containing it. False whenever that is not available - source/diff mode, a file with
		// no visual editor, a view still mounting, or a thread this view could not place - and
		// openFileAt above takes over unchanged.
		revealInVisual: (id) => {
			if (modes.mode !== 'visual' || !hasVisualMode(kind)) return false;
			const v = get(editorViewStore);
			return !!v && revealPmComment(v, id);
		},
		// a guest's events go up to the host, which owns the log; a host's go out to every guest.
		// Solo, both are no-ops and the log is just a file.
		publish: (event) => {
			if (guest) collabGuest.sendComment(event);
			else if (collabHost.active) collabHost.broadcastComment(event);
		}
	});
	// "not in this view" is a statement about the VISUAL view; source draws everything it resolves,
	// so the badge has to disappear in source mode - for the remembered files too, or the panel tells
	// a reader already in source to switch to source
	$effect(() => {
		commentsCtl.setVisualMode(modes.mode === 'visual');
	});
	// Which files the panel's threads can actually open: threads survive their file's deletion ON
	// PURPOSE (the log is append-only, and undoing the delete brings them straight back), so the
	// panel needs to know a thread's file is gone to say so instead of presenting a dead link.
	// null while no folder is open - "unknown", drawing no badges, rather than "everything missing".
	const commentFilesPresent = $derived.by(() => {
		const root = $workspaceRoot;
		if (!root) return null;
		return new Set(flatFiles($fileTree).map((p) => relativeTo(root, p)));
	});
	// a function, not a $derived: `kind` is declared further down and a derived would read it at
	// init. The same reason DiffMode takes getWorkingText as a callback.
	const commentText = () => (hasVisualMode(kind) ? doc.texSource : doc.rawContent);
	$effect(() => {
		// null for a guest: their workspaceRoot is the sentinel 'session', not a path, and the log
		// lives on the host's disk. Comments in a shared session need the session protocol to carry
		// their events; until it does, a guest has no log rather than a broken one.
		void commentsCtl.load(guest ? null : $workspaceRoot);
	});
	// A guest has no disk, so its log arrives over the wire: single events as they happen, and the
	// whole thing once on join. load(null) above leaves it empty until then rather than reading a
	// path built from the 'session' sentinel.
	$effect(() => {
		if (!guest) return;
		collabGuest.onCommentEvent = (event) => void commentsCtl.ingest(event);
		collabGuest.onCommentLog = (log) => commentsCtl.adopt(log, doc.path, untrack(commentText));
		// this guest clicked the streamed preview; the host's tinymist resolved the span and sent
		// the answer back here - the same landing an own-preview click gets on the host
		collabGuest.onTypstJump = (p) => {
			if (!isSafeRel(p.file) || !Number.isFinite(p.line) || p.line < 0) return;
			syncJumpToFileLine(p.file, Math.floor(p.line) + 1);
		};
		return () => {
			collabGuest.onCommentEvent = null;
			collabGuest.onCommentLog = null;
			collabGuest.onTypstJump = null;
		};
	});
	$effect(() => {
		// re-asked on every reconnect: events sent while we were away are only in the host's log
		if (guest && collabGuest.status === 'online') collabGuest.requestComments();
	});
	$effect(() => {
		// keyed on doc.path AND the view mode - NOT on the text, because while the editor is live
		// CodeMirror maps the decorations through each transaction - exactly - and re-searching on
		// top of that could snap a range onto another copy of the quote mid-edit. The mode matters
		// because leaving source unmounts the editor and CM's exactly-mapped ranges go with it, so
		// re-entering must re-search the current text rather than replay the pre-mount list (which
		// after edits can even point past the end of the file).
		void modes.mode;
		commentsCtl.reanchor(doc.path, untrack(commentText));
	});
	// macro-defining text from the main file's include chain, fed to the parser (see workspace/project.ts)
	let projectMacros = $state('');
	const folderEmpty = $derived($texFiles.length === 0);
	// lets the header's New file/folder buttons trigger the tree's inline create input
	let fileTreeRef = $state<{ newAtRoot: (type: 'file' | 'dir' | 'include', defaultName?: string) => void; isEditing: () => boolean }>();

	const kind = $derived(doc.kind);
	// a guest opening a text-looking file the host shares as name only (too large / extension the
	// session doesn't sync): say so instead of rendering a silently empty editor
	const nameOnly = $derived(guest && (hasVisualMode(kind) || isRawTextKind(kind)) && session.sharedKindOf(doc.path) === 'binary');

	// shared session: a file the host holds in a NON-Y-bound editor is host-exclusive (guests go
	// read-only), else concurrent guest edits to that file's Y.Text would be clobbered. Source mode
	// (tex/bib/text) is Y-bound and co-edits freely; BOTH visual dialects consume remote edits
	// through the re-parse patcher (VisualCollab), so only bib held in BibManager still locks —
	// BibManager isn't wired to the shared doc at all.
	function hostHoldsExclusively(k: string | null, mode: string, path: string | null): boolean {
		if (!path) return false;
		// markdown was listed here only while it had no remote-patch path; VisualCollab now serves
		// both visual dialects, so it co-edits exactly like tex does
		return k === 'bib' && mode !== 'source';
	}
	$effect(() => {
		if (!session.active) return;
		session.setVisualLock(hostHoldsExclusively(kind, modes.mode, doc.path) ? doc.path : null);
	});
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

	// starter templates + file import live in lib/workspace/starterActions.svelte.ts
	const starters = new StarterActions({
		loadRefs,
		refreshTree: () => refreshTree(),
		createEntry: (root, name, type) => treeOps.create(root, name, type)
	});
	const pickStarter = (s: Starter) => starters.pick(s);
	const importStarterFiles = (files: ImportedFile[]) => starters.importFiles(files);
	const newTexFile = () => starters.newTexFile();
	// File menu "New": inline create in the tree, pre-named for the chosen type
	function newFileOfType(ext?: string) {
		layout.sidebarOpen = true;
		fileTreeRef?.newAtRoot('file', starters.newFileName(ext));
	}

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
			resolveMainConfirm(root); // storage first, before anything can want a compile
			// Nothing can reach the last session's undo backups: the stack is memory-only, so they
			// became unreachable when the window closed. Purging on open (rather than on close) also
			// means they outlive a crash, and the files themselves are in the recycle bin regardless.
			void purgeUndoBackups(root).catch(() => {});
			void initProject(root);
		}
		tabs.bind(root, hostMode); // restore this folder's open tabs (guests start fresh)
		docPositions.bind(root, hostMode); // and where the caret was in each of them
		termDock.available = isDesktop() && hostMode; // client-only; set here so SSR/CSR agree
		if (guest) layout.pdfPaneOpen = true; // guests land with the host's PDF visible
		loadRefs(root);
		refreshTree();
		initSpellcheckConfig(); // seed editorConfigStore so the spell-check toggle works

		layout.restore(); // loadExistingPdf refills the preview if it was open last
		termDock.restore();
		modes.restore();
		diff.restoreLayout();

		const reloadReferences = () => {
			const r = get(workspaceRoot);
			if (r) void loadRefs(r);
		};
		const detachListeners = attachWindowListeners({
			refreshTree: () => void refreshTree(),
			reloadReferences,
			isHost: () => hostMode,
			checkExternalChange: () => void checkExternalChange(),
			runCompile: () => compiler.runCompile(),
			onWindowResize: layout.reclampPdf,
			reloadProjectState: () => {
				// both live in .texpile/ and both are committed, so both arrive by pull
				void commentsCtl.refresh();
				void projectConfig.refresh(guest ? null : get(workspaceRoot)).then(() => {
					compileCommand = resolveCompileCommand(get(mainFile));
				});
			}
		});
		const offBeforeClose = attachCloseGuard({
			promptIsOpen: () => !!unsaved.prompt,
			canCloseSilently: () => autosaveActive() || !doc.path || saver.pending?.path !== doc.path,
			flushSaves: () => saver.flushAndWait(),
			confirmLeaveUnsaved
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

	// every file that opens gains a tab (file tree, SyncTeX jumps, include links, restores)
	$effect(() => {
		const p = $activeFilePath;
		if (p) tabs.noteOpened(p);
	});

	// the first edit promotes the preview tab: from here on it is a file you are working on, not
	// one you glanced at, so the next file opened gets a tab of its own instead of taking this slot
	$effect(() => {
		const p = $activeFilePath;
		if ($isDirty && p) tabs.keep(p);
	});

	// Leaving a file in visual mode: record the caret before the switch tears the editor down. A plain
	// store subscription fires synchronously on set, ahead of any rendering, so the view is still
	// mounted - and doc.path is still the file we are LEAVING, since the load effect has not run yet.
	// (Nothing to do for source mode; SourceEditor keeps its own position.)
	onMount(() =>
		activeFilePath.subscribe(() => {
			const v = get(editorViewStore);
			if (!v || modes.mode !== 'visual' || !doc.path || session.collabFor(doc.path)) return;
			saveVisualPosition(v, doc.path, doc.texSource, doc.docMeta ? bodyOffsetOf(doc.docMeta) : 0);
		})
	);

	function activateTab(path: string) {
		activeFilePath.set(path);
	}
	// closing the active tab activates its neighbor; the load effect runs the usual save guards.
	// When that guard will prompt, the tab must survive until the dialog resolves (the store
	// reverts to it meanwhile), so the removal is deferred to the held-switch resolution.
	let pendingTabClose: string | null = null;
	function closeTab(path: string) {
		const active = get(activeFilePath);
		if (active && samePath(active, path)) {
			if (!autosaveActive() && saver.pending && samePath(saver.pending.path, path)) pendingTabClose = path;
			activeFilePath.set(tabs.neighborOf(path));
			if (pendingTabClose) return;
		}
		tabs.close(path);
	}

	// tree rescan + manifest sync + git refresh live in lib/workspace/treeRefresh.ts
	// treeRoot is the root the tree on screen currently reflects; plain, not $state, so recording it
	// cannot retrigger the effect below.
	let treeRoot: string | null = null;
	const refreshTree = async () => {
		treeRoot = get(workspaceRoot);
		await refreshTreeState({
			provider,
			session,
			isEditingTree: () => !!fileTreeRef?.isEditing?.()
		});
	};

	// The tree FOLLOWS the root. It used to be rescanned only where a folder was opened through
	// FolderLifecycle, but the root is also set straight from main's IPC handlers in App.svelte --
	// session restore, Open Folder in New Window, and an OS "open with" on a .tex file. Those set
	// texFiles and the active file but never the tree, so the explorer went on showing the folder
	// before it. Reacting to the root covers every route in and any route added later.
	// No double scan on the FolderLifecycle path: it awaits refreshTree itself, which records
	// treeRoot, so by the time this runs the root already matches and it stands down.
	$effect(() => {
		const root = $workspaceRoot;
		if (!root || root === treeRoot) return;
		void refreshTree();
	});

	// the shared file set changes under a guest whenever the host adds, renames or deletes a file.
	// The provider exposes a watch hook for exactly this; without it the tree only ever reflected
	// what was there at join time.
	onMount(() => provider.watch?.(() => void refreshTree()));

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
			openFileAtLine: (abs, line) => openFileAtLine(abs, line),
			showDiff: () => setViewMode('diff'),
			setViewMode,
			getViewMode: () => modes.mode,
			syncToLine: (line) => syncToLine(line),
			runCompile: () => compiler.runCompile(),
			setMainFile: (abs) => applyMainFile(abs),
			isCompiling: () => compiler.busy,
			getCompileCommand: () => compileCommand,
			// deferred through compileSettings so an MCP change persists exactly the way the dialog's
			// Save does - folder command, global default, folder output overrides
			applyCompile: (command, outputs) => compileSettings.applyCommand(command, outputs)
		})
	);

	function openEntry(entry: TreeEntry) {
		if (entry.type !== 'file') return;
		activeFilePath.set(entry.path);
	}

	const folder = new FolderLifecycle({
		scanTexFiles,
		confirmLeaveUnsaved: () => confirmLeaveUnsaved(),
		flushSaves: () => saver.flush(),
		flushSavesAndWait: () => saver.flushAndWait(),
		sessionActive: () => session.active,
		endSession: () => session.end(),
		hostMode: () => hostMode,
		refreshTree,
		loadRefs,
		resolveMainConfirm: (root) => resolveMainConfirm(root),
		setMainConfirmed: (v) => (mainPrompt.confirmed = v),
		loadExistingPdf: () => void compiler.loadExistingPdf(),
		setProjectMacros: (macros) => (projectMacros = macros),
		resetTerminals: () => resetTerminalsForWorkspace()
	});
	const openFolderFromMenu = (path?: string) => folder.open(path);
	const closeWorkspace = () => folder.close();
	const openTutorial = (root: string) => folder.openTutorial(root);
	const initProject = (root: string) => folder.initProject(root);
	let tutorialModalOpen = $state(false);

	/** the file tree's star: clicking the current main again clears it */
	const toggleMainFile = (path: string) => applyMainFile($mainFile && samePath($mainFile, path) ? null : path);

	// persist the new main file, re-gather macros, and re-derive the open visual doc from
	// doc.texSource so the newly resolved command signatures take effect immediately.
	// Takes the value to APPLY, not the file that was clicked: the toggle belongs to the click, and
	// an MCP caller naming the file that is already main must not have it cleared out from under them.
	async function applyMainFile(next: string | null) {
		const root = get(workspaceRoot);
		if (!root) return;
		setMainFile(root, next);
		// the main file is the project's, not this machine's: out to .texpile/config.json
		void projectConfig.save(root);
		mainPrompt.confirmed = true; // an explicit choice (set or clear) settles the first-compile question
		void compiler.loadExistingPdf(); // the main file changed â†’ its expected PDF did too
		projectMacros = next ? await gatherProjectMacros(next, root) : '';
		if (get(workspaceRoot) !== root) return;
		if (doc.path && kind === 'tex' && modes.mode === 'visual') rebuildVisualFromSource();
	}

	// create/rename/delete/move/import/copy live in lib/workspace/treeOps.ts
	const treeOps = new TreeOps({
		create: createEntry,
		remove: deleteEntry,
		rename: renameEntry,
		copy: copyEntry,
		// only the disk provider can park a deleted entry somewhere it can be fetched back from; a
		// guest gets neither, and TreeOps then records no history rather than offering an undo it
		// cannot honour
		trash: (p, dir) => provider.trash!(p, dir),
		restore: (from, to) => provider.restore!(from, to),
		supportsTrash: () => canTrash,
		writeBinary: writeBinaryFile,
		stat: statFile,
		refreshTree,
		loadRefs,
		// source-mode users write their own preamble (the editor's ghost offers the skeleton);
		// visual mode has no ghost and no way to write a preamble, so it gets one up front
		wantsStarter: () => modes.lastEditMode !== 'source',
		isTypstProject: () => typstProject,
		insertIncludeAtCursor: (path) => doInsertInclude(path),
		afterRename: (oldPath, newPath) => void afterRename(oldPath, newPath),
		// comment threads follow the file, on user gestures AND on undo/redo replays (which skip
		// afterRename because it prompts). Writes a `move` event to the log - see fileMoved.
		afterPathMoved: (from, to) => void commentsCtl.fileMoved(from, to),
		retargetPendingSave: (from, to) => {
			saver.retarget(from, to);
			retargetDiskStamp(from, to); // the guard's stamp must follow the rename too
		},
		discardPendingSave: () => saver.discard(),
		// the full set-main flow (store + config.json + macros + visual re-derive), so a renamed
		// main behaves exactly as if the user had starred the new path themselves
		retargetMainFile: (next) => void applyMainFile(next)
	});

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
	const showTerminal = () => termDock.show();
	const toggleTerminal = () => termDock.toggle();
	const toggleTerminalShrink = () => termDock.toggleShrink();
	const resetTerminalsForWorkspace = () => termDock.resetForWorkspace();
	const newTerminalFromMenu = () => termDock.newTerminal();

	let compileCommand = $state(''); // the compile command; {main} expands to the main file's path
	/**
	 * The project speaks Typst, read off the compile target the way the compile modal reads it.
	 * This is what gates every format-specific menu: New-file offers .typ instead of .tex/.cls/.sty,
	 * the tree's New Include produces a .typ fragment with a #include, and so on. Markdown is
	 * offered either way - it is format-neutral.
	 */
	const typstProject = $derived(isTypstCommand(compileCommand));
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
	// Draft mode, whole: root/main derivation, triggers, pause, the per-edit dispatcher, and
	// the engine lifecycle live in the controller; the preview chain gets this ONE object.
	const draftCtl = new DraftController({
		compileCommand: () => compileCommand,
		// hold the first live compile until the main file is confirmed
		mainConfirmed: () => mainPrompt.confirmed === true,
		pdfPaneOpen: () => layout.pdfPaneOpen,
		setPdfPaneOpen: (open) => layout.setPdfPaneOpen(open),
		openCompileModal: () => openCompileModal(),
		getSource: () => doc.texSource,
		getLoadedPath: () => doc.path,
		flushSaves: () => saver.flushAndWait()
	});
	// the Compile button doubles as the draft status (live / paused)
	const runDraftCompile = () => draftCtl.compile();
	// like the file tree's "Set as main file" (star badge included).
	// Tri-state: null = unresolved for the current folder; the modal never auto-opens on
	// null, so it can't flash while initProject is still scanning. Storage is consulted
	// SYNCHRONOUSLY on folder open (resolveMainConfirm) - a folder with a saved choice is
	// confirmed before the first render.
	let mainPrompt = $state(
		new MainFilePrompt({
			loadExistingPdf: () => void compiler.loadExistingPdf(),
			setProjectMacros: (macros) => (projectMacros = macros),
			releaseHeldDraftCompile: () => draftCtl.trigger++
		})
	);
	const resolveMainConfirm = (root: string | null) => mainPrompt.resolve(root);
	const openMainConfirm = (then?: () => void) => mainPrompt.prompt(then);
	// A main file that IS set answers the question this prompt exists to ask, whoever set it - the
	// tree, .texpile/config.json, MCP, a starter. Tracking "confirmed" separately let the two drift:
	// config.json is adopted in its own effect, so on a project whose config names a main it could
	// land AFTER initProject had already recorded "not confirmed", leaving a starred main that still
	// opened the picker on the first compile. Same symptom as the detection bug, different cause.
	$effect(() => {
		if ($mainFile) mainPrompt.confirmed = true;
	});
	// live mode compiles on its own as soon as the pane is open; surface the question then.
	// Strictly `=== false`: null means initProject is still resolving, never a modal.
	$effect(() => {
		const wants = $compileConfig.latex.liveMode && layout.pdfPaneOpen && !draftCtl.paused && !!$workspaceRoot && $texFiles.length > 1;
		if (wants && mainPrompt.confirmed === false && !mainPrompt.open) void mainPrompt.prompt();
	});
	const runDraftDecision = draftCtl.runDecision;
	// Draft mode leans on the on-disk file staying current: the full compile reads from disk,
	// Live mode and hosting a session both need current-on-disk content (the draft engine writes
	// nothing until a recompile; a session's host is the persistence authority). So autosave is
	// forced effectively on in both, WITHOUT changing the user's setting (it reverts on exit).
	// The Preferences toggle shows this as forced+disabled.
	function autosaveActive(): boolean {
		const s = get(settings);
		return s.autosave !== false || get(compileConfig).latex.liveMode || (session.active && !guest);
	}

	// a new folder starts blank: the previous folder's log, PDF and macros are meaningless here
	// (the switch now flips the root before its scan, so these would otherwise linger on screen)
	$effect(() => {
		void $workspaceRoot; // dependency: re-run per folder
		compileLog.set(null);
		pdfStore.set(null); // initProject's loadExistingPdf refills it for the new folder
		projectMacros = '';
		dockView = 'terminal';
		compiler.resetForFolder(); // any pollers still watching the previous folder's paths stand down
		compileCommand = resolveCompileCommand(get(mainFile));
	});
	// The project scan names the main file AFTER the folder effect above has run, so a Typst
	// project would otherwise sit on the inherited LaTeX command until something else re-resolved
	// it. Folders with a saved command of their own are unaffected (resolveCompileCommand prefers it).
	$effect(() => {
		const main = $mainFile;
		if (main) compileCommand = resolveCompileCommand(main);
	});
	// Problems are per-engine: switching the main between LaTeX and Typst would otherwise leave the
	// old engine's entries on the panel until the next compile happens to overwrite them. Cleared on
	// the lane change and re-shared, so a session's guests drop them at the same moment. Host-only:
	// a guest's panel mirrors the host's shared intel, never its own lane.
	let problemsLane = effectiveCompileFormat(get(mainFile));
	$effect(() => {
		const lane = effectiveCompileFormat($mainFile);
		if (guest || lane === problemsLane) return;
		problemsLane = lane;
		typstLiveDiags.clear();
		compileLog.set(null);
		shareCompileState();
	});
	// guests: surface the host's shared compile diagnostics through the same Problems UI the
	// host has (the raw log never crosses the wire; this rebuilds the parsed shape from intel)
	// guests: surface the host's shared compile diagnostics through the same Problems UI the host
	// has (see lib/collab/compileIntelBridge.ts)
	$effect(() => {
		if (!guest) return;
		compileLog.set(guestCompileLog(session.compileIntel, Date.now()));
	});

	// last compile's problems for the file open in source mode
	const sourceDiagnostics = $derived.by(() =>
		guest ? guestDiagnosticsFor(session.compileIntel, doc.path) : hostDiagnosticsFor($compileLog, $workspaceRoot, doc.path)
	);

	// ref to the compile-pane PDF viewer, for SyncTeX forward search
	let pdfPaneRef = $state<{ scrollToPosition: (page: number, x: number, y: number, w?: number, h?: number) => void }>();
	// a SyncTeX-inverse / Find-in-Files jump. the token distinguishes repeat jumps to the same line
	// so the editor re-fires; selectText is the word double-clicked in the PDF, anchored on to
	// correct for line drift (see SourceEditor's gotoLine effect)
	let sourceGotoLine = $state<{ line: number; token: number; selectText?: string; path: string } | undefined>(undefined);
	let gotoToken = 0;

	// compile / terminal / PDF-watch orchestration lives in lib/workspace/compilePipeline.svelte.ts
	const compiler = new CompilePipeline({
		getLoadedPath: () => doc.path,
		getCompileCommand: () => compileCommand,
		terminalAvailable: () => termDock.available,
		mainConfirmed: () => mainPrompt.confirmed,
		commandPending: () => !!projectConfig.pending,
		getSession: () => session,
		getDock: () => termDock.dock,
		stat: statFile,
		readText: readTextFile,
		create: createEntry,
		fileUrl,
		flushSaves: () => saver.flushAndWait(),
		refreshTree,
		showTerminal,
		setDockView: (v) => (dockView = v),
		setPdfPaneOpen: (open: boolean) => layout.setPdfPaneOpen(open),
		openCompileModal: () => openCompileModal(),
		openMainConfirm: (then) => void openMainConfirm(then),
		runDraftCompile,
		openTypstPreview: () => enableTypstPreview(),
		shareCompileState: () => shareCompileState()
	});

	// Typst live preview: recompile once typing settles. 700ms is chosen against the ~230ms a warm
	// rebuild takes -- long enough that a burst of typing produces one compile rather than five,
	// short enough that the preview feels attached to the editor.
	/** the data plane port of the running Typst preview; null when none has been started */
	let typstPreviewHost = $state<string | null>(null);
	/** the server's handle for the running preview, needed to stop it */
	let typstPreviewTask: string | null = null;

	/**
	 * tinymist's incremental viewer, in the preview pane.
	 *
	 * It previews the MAIN file, not whatever is focused: the preview is of the document, and a
	 * chapter opened on its own would compile to a fragment.
	 */
	/** guards against a second attach while the first executeCommand is still in flight */
	let typstPreviewStarting = false;
	/** the document the running task was started FOR; a main switch away from it re-attaches */
	let typstPreviewAttachedFile: string | null = null;

	async function openTypstPreview() {
		const root = get(workspaceRoot);
		const file = typstPreviewFile();
		if (!root || !file) return;
		try {
			// Started through the LANGUAGE SERVER, so it previews the server's in-memory document and
			// follows typing without a save. Deliberately no flushSaves() here: needing one would mean
			// we had started a standalone `tinymist preview`, which reads the file instead.
			const target = await startTypstPreview(root, file);
			if (!target) {
				// "tinymist isn't installed" gets the same tool-missing toast the shell compile
				// shows (name + the Toolchain prefs action); only a resolved-but-failed start
				// falls through to the generic failure below
				if (!(await tinymistResolved())) {
					toaster.error({
						title: m.compile_tool_missing_title(),
						description: m.compile_tool_missing({ tool: 'tinymist' }),
						duration: 8000,
						action: { label: m.compile_tool_missing_action(), onClick: openToolchainPrefs }
					});
					return;
				}
				throw new Error('tinymist did not return a preview address');
			}
			typstPreviewAttachedFile = file;
			typstPreviewHost = target.host;
			typstPreviewTask = target.taskId;
		} catch (err) {
			toaster.error({ title: m.typst_preview_failed(), description: err instanceof Error ? err.message : String(err) });
		}
	}

	/**
	 * Compile the previewed document to a PDF and offer it through a native save dialog - the
	 * same flow as draft mode's Save PDF, since neither live preview writes files on its own.
	 *
	 * Same target as the preview: the MAIN file. The export stages through the folder's build
	 * directory (where the compile command writes, `output/` by default) rather than tinymist's
	 * own default of "next to the entry file", so the staged copy is a build artifact in the
	 * build dir, not clutter in the project root. A cancelled dialog leaves it there and says
	 * nothing - it is exactly what Compile would have produced.
	 */
	async function saveTypstPdf(): Promise<void> {
		const root = get(workspaceRoot);
		const file = typstPreviewFile();
		if (!root || !file) return;
		try {
			const outDir = isTypstCommand(compileCommand) ? typstOutDir(compileCommand) : 'output';
			const staged = await exportTypstPdf(root, file, outDir);
			if (!staged) throw new Error('tinymist did not return a path');
			void refreshTree(); // the staged copy is real either way; show it in the sidebar
			const res = await savePdfAs(staged, staged);
			if (res.saved && res.path) toaster.success({ title: m.typst_pdf_saved_title(), description: res.path, duration: 4000 });
		} catch (err) {
			// The reject is tinymist's JSON-RPC error OBJECT, not an Error - String() on it prints
			// [object Object]. Every failure on this path means the same thing to the user (the
			// document did not produce a PDF), so the toast says that; the raw error goes to the
			// console for whoever needs it.
			console.error('typst pdf export failed:', err);
			toaster.error({ title: m.typst_pdf_save_failed(), description: m.typst_pdf_save_no_pdf() });
		}
	}

	/**
	 * Tell the server to stop compiling for a preview nobody is watching.
	 *
	 * Dropping the socket only detaches this end; the preview task lives on in the language server
	 * until it is killed, so without this each open-and-close would leave one behind.
	 */
	function detachTypstPreview() {
		sendCaretScroll.cancel(); // a scroll landing after the kill would be for a dead task
		typstPreviewAttachedFile = null;
		const task = typstPreviewTask;
		typstPreviewTask = null;
		if (task) void killTypstPreview(get(workspaceRoot), task);
	}

	// tinymist DIED under a running preview (crash, external kill - own stops never fire this).
	// The task and its port died with it, so drop the address without the doKillPreview round trip
	// (nothing left to kill, and its holder bookkeeping died with the server); the demand effect
	// below sees the null host and starts a fresh task while the pane is still wanted. Acts only
	// on a gen INCREASE: the effect also re-runs when the replacement task sets the host, and
	// treating that as a death would kill every fresh task after the first crash, forever.
	let seenServerGen = 0;
	$effect(() => {
		const gen = $typstServerGen;
		if (gen === seenServerGen) return;
		seenServerGen = gen;
		if (typstPreviewHost === null) return;
		sendCaretScroll.cancel();
		typstPreviewAttachedFile = null;
		typstPreviewTask = null;
		typstPreviewHost = null;
	});

	/**
	 * The palette entry. Turns the switch on and opens the pane rather than attaching directly:
	 * attaching behind a switch that says "off" would last exactly until the effect below noticed.
	 */
	function enableTypstPreview() {
		projectConfig.setTypstPreview(get(workspaceRoot), true);
		layout.setPdfPaneOpen(true);
	}

	// There is no debounced rebuild here any more. There used to be one - recompile 700ms after you
	// stopped typing - and the preview replaces it outright: it follows the language server's
	// in-memory document, so it is both faster and free of the save the rebuild needed. Keeping both
	// would have meant two live mechanisms behind one switch, and a CPU rebuilding a PDF nobody was
	// looking at.
	//
	/**
	 * Make the preview follow the caret (src -> doc).
	 *
	 * Opt-in: tinymist's own default follows only mouse-driven selection changes, because a preview
	 * that jumps on every keystroke is unpleasant. Ours is a switch instead, off unless asked for.
	 *
	 * The COLUMN is load-bearing, not garnish: the server resolves the position through
	 * jump_from_cursor, which only matches when the syntax leaf ending at the cursor is text.
	 * Column 0 sits after a linebreak, never after text, so sending it resolves to nothing -
	 * silently, since the server answers on the data plane, not to this call. A caret on markup
	 * still moves nothing (same in tinymist's own extension); typed text follows, because the
	 * caret then sits right after the text it typed.
	 *
	 * Debounced trailing: the caret hook now fires per column change, i.e. every keystroke.
	 */
	/** Where a typst follow/sync can go: the local task, or - as a guest - the host's streamed
	 *  preview (the host resolves the position and the relay routes the jump back to only us). */
	const typstScrollTarget = (): 'local' | 'remote' | null => {
		if (typstPreviewHost !== null && typstPreviewTask) return 'local';
		if (guest && collabGuest.typstPreviewOffered) return 'remote';
		return null;
	};
	/** The manifest-relative path of `file`, for a guest's scroll request. A guest's doc paths are
	 *  ALREADY manifest-relative (its workspaceRoot is the 'session' sentinel, not a prefix of
	 *  them - relFromRoot would slice real characters off); only a 'session/'-prefixed jump target
	 *  needs stripping, and an absolute path is not the session's to ask about. */
	const guestScrollRel = (file: string): string | null => {
		const norm = file.replace(/\\/g, '/');
		const root = get(workspaceRoot);
		if (root && norm.startsWith(root.replace(/\\/g, '/') + '/')) return norm.slice(root.length + 1);
		return /^([A-Za-z]:|\/)/.test(norm) ? null : norm;
	};
	const sendTypstScroll = (file: string, line: number, character: number): void => {
		if (typstScrollTarget() === 'remote') {
			const rel = guestScrollRel(file);
			if (rel) collabGuest.requestTypstScroll(rel, line, character);
			return;
		}
		if (typstPreviewTask) void scrollTypstPreview(get(workspaceRoot), typstPreviewTask, file, line, character);
	};
	const sendCaretScroll = trailingDebounce(150, ({ line, character }: { line: number; character: number }) => {
		if (typstScrollTarget() === null) return;
		if ($settings.typstPreviewFollow !== true) return;
		// the FOCUSED file, not the main one: the caret is in the file being edited, and pairing
		// it with main.typ's path asks the server to resolve a position that does not exist
		const file = doc.path;
		if (!file) return;
		// follow jumps are ambient: warn the frame so it swallows the viewer's jump ripple.
		// One-shot syncs (syncTypstForward and friends) deliberately do NOT send this.
		noteFollowScroll();
		sendTypstScroll(file, line, character);
	});
	function onCaretMove(line: number, character: number) {
		// gate before enqueueing too, so an off switch means no timer churn while typing
		if (typstScrollTarget() === null || $settings.typstPreviewFollow !== true) return;
		sendCaretScroll({ line, character });
	}

	/**
	 * Visual-mode follow: the PM caret has no source line of its own, so it goes through the orig
	 * block map - block-granular from the parse stamps, refined inside the block by text anchoring,
	 * the same machinery the mode switch uses to carry the caret across. Blocks edited since the
	 * last reparse anchor approximately until the post-save reparse restamps them, which is the
	 * accuracy collab presence already lives with.
	 */
	/** the tex preamble's length in visual mode; 0 for typst, whose whole file is body. */
	const visBodyOffset = () => (doc.docMeta ? bodyOffsetOf(doc.docMeta) : 0);
	/** the visual caret as a zero-based source line/character, through the orig block map -
	 *  dialect-agnostic (the stamps carry absolute file offsets once bodyOffset is applied).
	 *  Never returns column 0: it resolves to the line's first word end instead, or null. */
	function visualCaretSourcePos(): { line: number; character: number } | null {
		const v = get(editorViewStore);
		if (!v) return null;
		const pmDoc = v.state.doc;
		const off = pmPosToSourceOffset(pmDoc, buildBlockMap(pmDoc, visBodyOffset()), v.state.selection.head);
		if (off == null) return null;
		const upto = doc.texSource.slice(0, Math.min(off, doc.texSource.length));
		const nl = upto.lastIndexOf('\n');
		const character = upto.length - nl - 1;
		const line = (upto.match(/\n/g) ?? []).length;
		if (character > 0) return { line, character };
		// column 0: `off` is the line start, so rescue the jump onto the same line's first word
		const rescued = firstWordEndOnLine(doc.texSource, off);
		return rescued == null ? null : { line, character: rescued };
	}
	const sendVisualCaretScroll = trailingDebounce(150, (_: null) => {
		if (typstScrollTarget() === null) return;
		if ($settings.typstPreviewFollow !== true) return;
		const file = doc.path;
		if (!file) return;
		const pos = visualCaretSourcePos();
		if (!pos) return; // no resolvable position on that line at all
		noteFollowScroll();
		sendTypstScroll(file, pos.line, pos.character);
	});

	// Click-to-jump out of the preview. The framed page cannot reach us - different origin, on
	// purpose - so it reports the clicked span over its own websocket, tinymist resolves it, and the
	// answer arrives as an LSP notification. Same channel tinymist's VS Code extension uses; this is
	// Typst's only route to inverse search, since Typst has no SyncTeX and its PDF carries no source
	// mapping at all.
	/**
	 * Inverse sync landing (SyncTeX click and the typst preview's click alike): visual mode stays
	 * visual - the jump becomes a caret placement through the block map (same file) or a stored
	 * position the visual restore reads back on mount (another file). Source/diff keep the source
	 * jump. Find-in-Files style jumps keep calling openFileAtLine directly: those want the line.
	 */
	function syncJumpToFileLine(file: string, line: number, selectText?: string) {
		if (modes.mode === 'visual' && hasVisualMode(kind)) {
			const target = sessionRelativeTarget(file, guest);
			docPositions.set(target, { row: line - 1, column: 0, firstVisibleLine: line });
			if (target === doc.path) {
				const v = get(editorViewStore);
				if (v) restoreVisualPosition(v, target, doc.texSource, visBodyOffset(), kind === 'typ' ? stripTypst : undefined);
			} else if (needsActivate(target)) {
				activeFilePath.set(target);
			}
			return;
		}
		openFileAtLine(file, line, selectText);
	}

	// tinymist can deliver ONE preview click through two channels (the scrollSource notification
	// and the showDocument request); without this the second delivery found the guest's claim
	// already consumed and jumped the HOST's editor too. Harmless for the host's own clicks -
	// jumping twice to the same line is invisible - so this only needs to be approximate.
	let lastPreviewJump = { key: '', at: 0 };
	$effect(() => {
		if (typstPreviewHost === null) return;
		setPreviewJumpHandler((jump) => {
			if (!jump?.filepath || !jump.start) return;
			const key = `${jump.filepath}:${jump.start[0]}:${jump.start[1]}`;
			if (key === lastPreviewJump.key && Date.now() - lastPreviewJump.at < 800) return;
			lastPreviewJump = { key, at: Date.now() };
			// A GUEST's preview click: tinymist resolved it, but the resolution belongs to the
			// guest that clicked, not to this editor - hand it back over the session instead.
			const clicker = previewRelay.claimSrcClick();
			if (clicker !== null) {
				const root = get(workspaceRoot);
				const rel = root ? relFromRoot(jump.filepath, root) : '';
				if (rel && rel !== jump.filepath.replace(/\\/g, '/')) {
					collabHost.replyControl({ kind: 'typst-jump', file: rel, line: jump.start[0] }, clicker);
				}
				return;
			}
			// tinymist speaks zero-based LSP positions; the jump helper wants one-based lines
			syncJumpToFileLine(jump.filepath, jump.start[0] + 1);
		});
		return () => setPreviewJumpHandler(null);
	});

	// The Preview switch drives the pane, exactly as draftMode does for LaTeX: turn it on with a
	// Typst file open and the preview pane is what you get, no separate command to find. Attaching
	// is what costs (an executeCommand, then the ~1.2MB renderer), so it happens only once the pane
	// is actually open, and detaching on close frees the server's preview and the wasm session.
	/**
	 * This pane is FOR a Typst preview, whether or not one has started yet.
	 *
	 * The pane branches on this rather than on the host, so the compiled PDF never flashes up for the
	 * moment it takes doStartPreview to answer.
	 *
	 * Pinned to the MAIN file, and nothing else. There used to be fallbacks - the focused .typ, a
	 * sticky latch remembering the last previewed one - all covering the mainless state, where they
	 * bought a preview at the price of it silently going stale (unset the main, focus another file,
	 * and the pane kept rendering whatever it had attached to). Now the mainless state is a message
	 * in the pane with a button (see mainUnset below), so the fallbacks cover nothing: a .typ main
	 * previews, and focusing a .bib or an image beside it changes nothing because the main hasn't.
	 */
	const mainIsTypst = $derived($mainFile?.toLowerCase().endsWith('.typ') === true);
	const typstPreviewWanted = $derived(mainIsTypst && typstPreviewAvailable && !guest);

	/** the previewed document: the main file, always (typstPreviewWanted holds otherwise) */
	function typstPreviewFile(): string | null {
		return get(mainFile);
	}

	/**
	 * No main file in a folder that has candidates: the preview pane can only show something
	 * wrong (a stale PDF, a fragment compile), so it shows this instead - a message and the
	 * picker - and BOTH live modes count as off, which is what stops draft mode re-targeting
	 * the warm engine onto whatever fragment happens to have focus. An empty folder is not
	 * "unset" (there is nothing to pick), and a guest never picks (compiling is the host's).
	 */
	const mainUnset = $derived(!guest && !$mainFile && $texFiles.length > 0);

	$effect(() => {
		// guests holding the stream keep the task alive with the host's own pane closed; their
		// demand exists only while hosting, so this never starts a task for a lone workspace
		const want = typstPreviewWanted && (layout.pdfPaneOpen || previewRelay.demand > 0);
		// tracked: switching the main from one .typ to ANOTHER keeps `want` true, so without
		// this the task attached to the old document would run - and stream to guests - forever
		const target = $mainFile;
		if (want && typstPreviewHost === null && !typstPreviewStarting) {
			typstPreviewStarting = true;
			void openTypstPreview().finally(() => (typstPreviewStarting = false));
		} else if (typstPreviewHost !== null && (!want || target !== typstPreviewAttachedFile)) {
			// the falling edge, and the retarget: kill the task; the effect re-runs on the host
			// reset and re-attaches onto the current main when still wanted
			typstPreviewHost = null;
			detachTypstPreview();
		}
	});

	// ---- the preview stream's host end ----
	// the relay dials the data plane, so it needs the task's address (and its disappearance)
	$effect(() => previewRelay.setHost(typstPreviewHost));
	// the relay found the task's port dead (dials refused): kill it; the demand effect above
	// starts a fresh one for the guests still asking - the same moves as a main-file retarget
	$effect(() => {
		previewRelay.onTaskUnreachable = () => {
			if (typstPreviewHost === null) return;
			typstPreviewHost = null;
			detachTypstPreview();
		};
		return () => (previewRelay.onTaskUnreachable = null);
	});
	// legs of departed guests close with them
	$effect(() => previewRelay.prune(collabHost.peerIds));
	// guests flip between stream and pushed PDF off this flag (late joiners read it from doc state)
	$effect(() => {
		void collabHost.peerIds; // re-assert per join, belt and braces; the write is change-gated
		if (collabHost.active && !guest) collabHost.advertiseTypstPreview(typstPreviewWanted);
	});

	// ---- the Problems panel in Preview mode ----
	// With Preview on, Compile never shell-runs, so the log watcher that normally fills the
	// panel has nothing to parse - yet the errors exist, live, as tinymist's LSP diagnostics
	// (the same compiler the preview renders with). Feed the panel from those instead. They
	// arrive per FILE and clear per file (an empty list), so a map accumulates the project view.
	// Note: diagnostics published before the preview opened are not replayed; the panel fills
	// on the next edit. Deliberately not active outside Preview mode, where the shell compile's
	// parsed log owns the panel and two writers would fight.
	const typstLiveDiags = new Map<string, TypstDiagnostic[]>();
	$effect(() => {
		if (!typstPreviewWanted) return;
		setTypstDiagnosticsHandler((path, diags) => {
			if (diags.length) typstLiveDiags.set(path, diags);
			else typstLiveDiags.delete(path);
			publishTypstProblems();
		});
		return () => {
			setTypstDiagnosticsHandler(null);
			typstLiveDiags.clear();
		};
	});

	function publishTypstProblems(): void {
		const root = (get(workspaceRoot) ?? '').replace(/\\/g, '/');
		const entries: LogEntry[] = [];
		for (const [path, diags] of typstLiveDiags) {
			const norm = path.replace(/\\/g, '/');
			// root-relative, the shape resolveLogPath() expects for click-to-jump
			const rel = root && norm.toLowerCase().startsWith(root.toLowerCase() + '/') ? norm.slice(root.length + 1) : norm;
			for (const d of diags) {
				if ((d.severity ?? 1) >= 3) continue; // info/hint stay in the editor gutter only
				entries.push({
					level: (d.severity ?? 1) <= 1 ? 'error' : 'warning',
					message: d.message.split('\n')[0],
					context: d.message,
					file: rel,
					line: d.range.start.line + 1,
					column: d.range.start.character + 1,
					raw: d.message
				});
			}
		}
		compileLog.set({
			entries,
			errors: entries.filter((e) => e.level === 'error'),
			warnings: entries.filter((e) => e.level === 'warning'),
			badboxes: [],
			files: [],
			status: { fatal: false, emergencyStop: false, noPages: false },
			logPath: '',
			updatedAt: Date.now()
		});
	}

	// share the current pdf + log once when we start hosting (see CompilePipeline.shareExistingOutputs)
	let outputsSharedForSession = false;
	$effect(() => {
		if (session.active && !session.isGuest) {
			if (!outputsSharedForSession) {
				outputsSharedForSession = true;
				void compiler.shareExistingOutputs();
			}
		} else {
			outputsSharedForSession = false;
		}
	});
	// not a guest (solo or host): if the folder already has a .log from a previous compile, load its
	// problems on open so they show without a recompile. Re-runs as the command + main file resolve
	// (they fix the log path); a real compile that fills the log first wins.
	let existingLogLoadedFor: string | null = null;
	$effect(() => {
		const root = $workspaceRoot;
		void compileCommand; // dep: the log path depends on the resolved command
		void $mainFile; // dep: and on the detected main file
		if (guest || !root) {
			existingLogLoadedFor = null;
			return;
		}
		// mid folder-switch (root flipped, scan pending): the fallbacks below would resolve the
		// PREVIOUS folder's log and publish its problems here. The scan landing re-runs this.
		if (!$mainFile && $texFiles.length === 0) return;
		if (existingLogLoadedFor === root) return;
		untrack(() => {
			if (get(compileLog)) {
				existingLogLoadedFor = root; // a compile already populated it
				return;
			}
			const logPath = compiler.expectedLogPath();
			if (!logPath) return; // command / main file not resolved yet; a later run retries
			existingLogLoadedFor = root;
			void (async () => {
				const s = await statFile(logPath);
				if (s.exists && s.size > 0 && get(workspaceRoot) === root && !get(compileLog)) {
					await compiler.publishLogDiagnostics(logPath, s.mtimeMs, true);
				}
			})();
		});
	});
	// open/close the PDF pane and remember the choice so a reload restores it
	function jumpPdf(page: number, x: number, y: number, w: number, h: number, tries = 0) {
		if (pdfPaneRef) {
			pdfPaneRef.scrollToPosition(page, x, y, w, h);
			return;
		}
		if (tries < 30) setTimeout(() => jumpPdf(page, x, y, w, h, tries + 1), 30); // wait for the pane to mount
	}
	// open a file in source mode and jump to a 1-based line (SyncTeX inverse + Find-in-Files)
	function openFileAtLine(file: string, line: number, selectText?: string) {
		const target = sessionRelativeTarget(file, guest);
		modes.mode = 'source';
		updateLayout({ viewMode: 'source' });
		sourceGotoLine = { line, token: ++gotoToken, selectText, path: target };
		if (needsActivate(target)) activeFilePath.set(target);
	}
	// forward/inverse SyncTeX resolution lives in lib/workspace/syncTexNav.ts
	const syncTex = new SyncTexNav({
		isGuest: () => guest,
		getLoadedPath: () => doc.path,
		isTex: () => kind === 'tex',
		getDraftRoot: () => draftCtl.root,
		expectedPdfPath: () => compiler.expectedPdfPath(),
		setPdfPaneOpen: (open: boolean) => layout.setPdfPaneOpen(open),
		scrollPdfTo: jumpPdf,
		syncDraftTo: (page, x, y, w, h) => draftCtl.view?.syncTo(page, x, y, w, h),
		// inverse clicks land in whichever mode the user is in; see syncJumpToFileLine
		openFileAtLine: syncJumpToFileLine
	});
	const syncForwardLine = (line: number) => syncTex.forwardToLine(line);

	/**
	 * One-shot src -> preview jump for Typst: the counterpart of SyncTeX's forward search, and
	 * the same server call follow uses - fired once, on demand, so it earns its place exactly
	 * when the follow toggle is off. Reads the caret from the live editor view the way
	 * forwardFromCursor does for .tex; the position must sit in text to resolve (tinymist's
	 * jump_from_cursor), same as follow.
	 */
	/** The rendered sync entry points only exist when a preview target should too (WorkspaceMain's
	 * canSync gate), but wanted is not attached - tinymist may still be starting or have died -
	 * and MCP's syncToLine bypasses the gate entirely. Typst has no SyncTeX: only the live
	 * preview can resolve a source position, so explain the miss instead of silently no-oping. */
	function typstSyncUnavailable(): boolean {
		if (typstScrollTarget() !== null) return false;
		toaster.info({ title: m.typst_sync_preview_only_title(), description: m.typst_sync_preview_only_desc(), duration: 5000 });
		return true;
	}

	async function syncTypstForward(): Promise<void> {
		if (typstSyncUnavailable()) return;
		const file = doc.path;
		if (!file) return;
		const cm = get(sourceCmView);
		if (cm && cm.dom.isConnected) {
			const head = cm.state.selection.main.head;
			const docLine = cm.state.doc.lineAt(head);
			sendTypstScroll(file, docLine.number - 1, head - docLine.from);
			return;
		}
		// Visual mode: the PM caret through the block map, one shot (no follow bookkeeping).
		//
		// Flush pending saves first. In source mode the LSP client streams didChange, so the
		// server's copy IS what the caret was measured against; the visual editor has no such
		// stream, and the server falls back to the file on disk - so an unsaved edit shifts every
		// offset after it and the jump lands on the wrong line or nowhere. One save closes that
		// gap, and it is a deliberate click, so paying for it here is cheap.
		await saver.flushAndWait();
		const pos = visualCaretSourcePos();
		if (!pos) return;
		sendTypstScroll(file, pos.line, pos.character);
	}
	const syncForward = () => {
		if (kind === 'typ') {
			void syncTypstForward();
			return;
		}
		// SyncTeX from the visual editor: the PM caret's block-map line feeds the line-based
		// forward search (SyncTeX is line-granular anyway)
		if (modes.mode === 'visual') {
			const pos = visualCaretSourcePos();
			if (pos) syncTex.forwardToLine(pos.line + 1);
			return;
		}
		syncTex.forwardFromCursor();
	};

	/**
	 * Line-based variant for the context menu's "Show in preview" and MCP's syncToLine. A line
	 * has no column, and the column decides whether tinymist resolves anything at all, so aim
	 * just past the line's last non-space character - a heading resolves through its text, and a
	 * markup-only line (#set ...) resolves to nothing, exactly as follow would.
	 */
	function syncTypstForwardLine(line1: number): void {
		if (typstSyncUnavailable()) return;
		const file = doc.path;
		const cm = get(sourceCmView);
		if (!file || !cm) return;
		const l = cm.state.doc.line(Math.min(Math.max(line1, 1), cm.state.doc.lines));
		const character = l.text.replace(/\s+$/, '').length;
		if (typstPreviewTask) void scrollTypstPreview(get(workspaceRoot), typstPreviewTask, file, l.number - 1, character);
	}
	/** per-language routing for every "jump the output to line N" entry point */
	const syncToLine = (line: number) => (kind === 'typ' ? syncTypstForwardLine(line) : syncForwardLine(line));
	const onPdfDoubleClick = (page: number, x: number, y: number, selectText?: string) => syncTex.inverseFromClick(page, x, y, selectText);

	// ---- Zotero citations (host-only; see lib/zotero) ----
	// The open file's dialect must match the main's engine: the imported entries land in the
	// bibliography the MAIN file declares, so a .typ scratch file open in a LaTeX project has
	// nowhere sensible to point its citation.
	// zoteroEnabled gates every entry point (editor context menu, command palette) through this one predicate
	const canZoteroCite = () =>
		$settings.zoteroEnabled !== false && !guest && zoteroAvailable() && !!$mainFile && (mainIsTypst ? kind === 'typ' : kind === 'tex');
	const insertZoteroCitation = () => {
		if (!canZoteroCite()) return;
		void insertCitationFromZotero({
			kind: kind as 'tex' | 'typ',
			root: get(workspaceRoot) ?? '',
			openDoc: () => ({ path: doc.path, text: doc.buffer })
		});
	};

	// compile-command dialog state lives in lib/workspace/compileSettings.svelte.ts
	let compileSettings = $state(
		new CompileSettings(
			() => compileCommand,
			(c) => (compileCommand = c),
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
	const openCompileModal = () => {
		if (hostMode && !get(mainFile) && get(texFiles).length > 0 && !mainPrompt.open) {
			void openMainConfirm(() => compileSettings.open());
			return;
		}
		compileSettings.open();
	};
	const saveCompileCommand = (thenRun: boolean) => compileSettings.save(thenRun);
	const useDefaultCommand = () => compileSettings.useDefault();

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
	const doRunFormat = () => {
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
	};
	const doInsertInclude = (newFilePath: string) =>
		typstProject
			? insertTypstIncludeAtCursor(newFilePath, doc.path)
			: insertIncludeAtCursor(newFilePath, doc.path, modes.mode === 'visual');

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

	// after a rename/move, find \includegraphics/\input across the project's .tex files
	// that pointed at the file (AST-based) and offer to repoint them
	let pendingRefUpdate = $state<RefUpdate | null>(null);

	const refUpdateDeps = {
		getLoadedPath: () => doc.path,
		getSourceText: () => doc.texSource,
		setSourceText: (t: string) => (doc.texSource = t),
		readText: readTextFile,
		scanFiles: async (exts: string[]) => (await provider.scanFiles($workspaceRoot ?? '', exts)).map((f) => f.path),
		writeText: writeTextFile,
		onActiveFileEdited: () => {
			if (modes.mode === 'visual') rebuildVisualFromSource();
			isDirty.set(true);
			saver.schedule(doc.path, doc.texSource);
		}
	};
	async function afterRename(oldPath: string, newPath: string) {
		pendingRefUpdate = await scanRenamedRefs(oldPath, newPath, refUpdateDeps);
	}
	async function doApplyRefUpdate() {
		const u = pendingRefUpdate;
		pendingRefUpdate = null;
		if (u) await applyRefUpdate(u, refUpdateDeps);
	}

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
			if (live && !guest) shareCompileState();
		});
	});

	const shareCompileState = () => shareHostCompileState(session, guest);

	// \includegraphics hover preview: candidate texfile:// URLs (current dir, root, and any
	// \graphicspath dirs, adding raster extensions when the path has none); the tooltip's img
	// advances past misses
	// the visual editor's shared-session machinery (remote patches, presence) lives in
	// VisualCollab; this api hands it doc-state access, the ref carries its editor hooks
	let visualCollab = $state<{ noteLocalEdit(): void; noteFreshParse(): void; publishCursor(): void } | null>(null);
	const visualCollabApi = visualCollabBridge({
		doc,
		parser,
		parse: (text) => tryParseVisual(text),
		scheduleSave: (path, content) => saver.schedule(path, content)
	});

	// visual-editor file access (figure previews, image paste) resolves through the provider,
	// so a guest's images come from the session blob cache and uploads go through the session
	setEditorFileAccess(
		(p) => provider.fileUrl(p),
		(p, data) => provider.writeBinary(p, data)
	);
	setGraphicResolver((rel) =>
		graphicCandidateUrls(rel, { root: get(workspaceRoot), loadedPath: doc.path, source: doc.texSource, fileUrl })
	);
	onDestroy(() => {
		setGraphicResolver(null);
		setEditorFileAccess(null, null);
		detachTypstPreview(); // leaving the workspace must not leave a preview compiling in the server
		projectConfig.reset(); // adopted compile state is per folder; the start screen holds defaults
	});

	// shared session: guests can ask for a compile; leaving the workspace ends the session
	let shareModalOpen = $state(false);
	onMount(() =>
		attachSessionHandlers(session, {
			runCompile: () => void compiler.runCompile(),
			isBusy: () => compiler.busy,
			refreshTree: () => void refreshTree(),
			expectedPdfPath: () => compiler.expectedPdfPath(),
			applyCommentEvent: (event) => void commentsCtl.ingest(event),
			commentLog: () => commentsCtl.store.serialize(),
			typstScrollForGuest: (rel, line, character) => {
				const root = get(workspaceRoot);
				if (!root || !typstPreviewTask) return;
				void scrollTypstPreview(root, typstPreviewTask, joinPath(root, rel), line, character);
			}
		})
	);

	// F12 on an \input{...} target: resolve like LaTeX would (current dir, then root, .tex added)
	const jumpToInclude = (name: string) => jumpToIncludeTarget(name, doc.path, statFile, guest);
	// keep the label registry, the embedded bibitem refs, and the cross-mode undo history fresh
	$effect(() => {
		void doc.texSource; // dependency: re-arm the debounce on every source change
		return registries.schedule();
	});

	// unsaved-edit gate for both file switches and workspace-level exits; see lib/workspace/unsavedGuard.svelte.ts
	const unsaved = new UnsavedGuard({
		saver: () => saver,
		getLoadedPath: () => doc.path,
		getEol: () => doc.eol,
		autosaveActive,
		takePendingTabClose: () => {
			const p = pendingTabClose;
			pendingTabClose = null;
			return p;
		},
		clearPendingTabClose: () => (pendingTabClose = null)
	});
	const confirmLeaveUnsaved = () => unsaved.confirmLeave();

	// load the active file whenever it changes. Everything but the store read is untracked, so
	// this runs exactly once per path change (doc.path updating mid-load must not re-fire it).
	$effect(() => {
		const path = $activeFilePath;
		untrack(() => {
			// a workspace-level prompt (folder switch / close / window close) detached the pending
			// edit, so the guard below can't see it: park ALL file switches until it resolves, or a
			// Ctrl+Tab under the modal reattaches the edit against the wrong file
			if (unsaved.parksAllSwitches) {
				if (path !== doc.path) activeFilePath.set(doc.path);
				return;
			}
			// while the dialog is up, keep the UI parked on the outgoing file; remember the newest
			// destination (Ctrl+Tab still works under the modal) and resolve it after the answer
			if (unsaved.held) {
				if (path !== doc.path) {
					unsaved.held.target = path;
					activeFilePath.set(doc.path);
				}
				return;
			}
			// autosave off: the outgoing file's edit wasn't auto-written, so ask BEFORE switching.
			if (unsaved.needsPromptFor(path)) {
				unsaved.beginFileSwitch(path);
				return;
			}
			saver.flush(); // persist the outgoing file's queued edit before tearing down its buffers
			doc.loadError = null;
			// the outgoing file stays on screen until loadFile has the new one ready: clearing here
			// first is what made every switch blink through the "Opening…" placeholder
			if (path) loadFile(path);
			else closeOpenFile();
		});
	});

	/** drop the open file's buffers AND the per-file view state that must not leak into the next file */
	function closeOpenFile() {
		doc.close();
		clearPerFileViewState();
		sourceHistory.disable();
	}

	/** anchors are keyed to the outgoing file's text; a new file must never inherit them */
	function clearPerFileViewState() {
		modes.sourceScrollAnchor = null;
		modes.pendingVisualAnchor = null;
		// a jump asked for THIS file survives (that is why we're opening it); an older one must not,
		// or every later tab switch remounts the source editor and replays it
		if (sourceGotoLine && !samePath(sourceGotoLine.path, doc.path ?? '')) sourceGotoLine = undefined;
	}

	// opening the active file into the buffers lives in lib/workspace/fileOpener.ts
	const opener = new FileOpener({
		doc,
		parser,
		readText: readTextFile,
		whenIdle: () => saver.whenIdle(),
		isVisualMode: () => modes.mode === 'visual',
		isSourceMode: () => modes.mode === 'source',
		isDiffMode: () => modes.mode === 'diff',
		claimVisualLock: (path) => {
			if (session.active) session.setVisualLock(hostHoldsExclusively(fileKind(path), modes.mode, path) ? path : null);
		},
		beforeOpen: (path) => session.beforeOpen(path),
		// MUST honor the opener's format: it parses BEFORE doc.path switches, so the reactive
		// `kind` (tryParseVisual) still points at the outgoing file and cross-format opens
		// would parse .tex as markdown (and vice versa)
		parse: (text, format) => parser.parse(text, format),
		fallbackToSource,
		resetHistory: (text) => sourceHistory.reset(text),
		disableHistory: () => sourceHistory.disable(),
		clearPerFileViewState,
		captureDiffSnapshot: () => void captureDiffSnapshot(),
		closeOpenFile: () => closeOpenFile()
	});
	const loadFile = (path: string) => opener.open(path);

	// on-disk change detection + conflict resolution live in lib/workspace/externalChange.svelte.ts
	const external = new ExternalChangeWatcher({
		getLoadedPath: () => doc.path,
		isTextual: () => hasVisualMode(kind) || isRawTextKind(kind),
		isStructured: () => hasVisualMode(kind),
		whenIdle: () => saver.whenIdle(),
		readText: readTextFile,
		getDiskBaseline: () => doc.diskBaseline,
		setDiskBaseline: (t) => (doc.diskBaseline = t),
		getBuffer: () => (hasVisualMode(kind) ? doc.texSource : doc.rawContent),
		setTexSource: (t) => (doc.texSource = t),
		setRawContent: (t) => (doc.rawContent = t),
		setEol: (e) => (doc.eol = e),
		rebuildVisual: rebuildVisualFromSource,
		discardQueuedSave: () => saver.discard(),
		sessionEdit: (path, content) => session.edit(path, content),
		saveNow: () => doc.save(true) // force: the user chose "keep mine" knowing disk differs
	});
	const checkExternalChange = () => external.check();
	const resolveConflict = (choice: 'reload' | 'keep') => external.resolve(choice);

	// debounced autosave + serial write chain live in lib/workspace/savePipeline.svelte.ts
	const saver = new SavePipeline({
		sessionEdit: (path, content) => session.edit(path, content),
		isGuest: () => guest,
		autosaveActive,
		writeText: writeTextFile,
		getEol: () => doc.eol,
		getLoadedPath: () => doc.path,
		getLiveContent: () => (hasVisualMode(kind) ? doc.texSource : doc.rawContent),
		setDiskBaseline: (content) => (doc.diskBaseline = content),
		setDirty: (dirty) => isDirty.set(dirty),
		diskChanged: diskChangedSince,
		recordDiskStamp,
		// the aborted save's content is still the live buffer, so check() sees dirty-and-different
		// and raises its conflict modal; "keep mine" comes back through saveNow with force
		raiseConflict: () => void checkExternalChange()
	});

	const onChange = (node: PMNode) => doc.onVisualChange(node);
	const editPreambleFrontmatter = (kind: string, inner: string) => doc.editFrontmatter(kind, inner);
	const onTexInput = (v: string) => doc.onTexInput(v);
	const onRawInput = (v: string) => doc.onRawInput(v);

	// source control ops live in lib/workspace/scmActions.svelte.ts; the panel is presentational.
	const scm = new ScmActions({
		getLoadedPath: () => doc.path,
		discardPendingSave: () => saver.discard(),
		deleteEntry,
		refreshTree,
		loadFile,
		captureDiffSnapshot: () => void captureDiffSnapshot(),
		isDiffMode: () => modes.mode === 'diff',
		enterDiffMode: () => (modes.mode = 'diff')
	});

	function fallbackToSource(failure: ParseFailure): void {
		modes.mode = 'source';
		doc.visualDoc = null;
		modes.pendingVisualAnchor = null; // never re-anchor a later visual entry off this failed switch
		if (failure.tooComplex) {
			toaster.warning({
				title: m.wsview_toast_too_complex_title(),
				description: m.wsview_toast_too_complex_desc({ count: failure.tooComplex.toLocaleString() })
			});
		} else if (failure.timeout) {
			toaster.warning({ title: m.wsview_toast_file_too_large_title() });
		} else {
			toaster.error({ title: m.wsview_toast_parse_failed_title(), description: failure.message });
		}
	}

	function rebuildVisualFromSource(): void {
		// fast path: source unchanged since the last successful parse, keep the mounted PM view
		if (doc.texSource === parser.lastParsedSource && doc.visualDoc) return;

		const mySeq = parser.nextSequence();
		void tryParseVisual(doc.texSource).then((o) => {
			if (!parser.isCurrent(mySeq)) return; // superseded
			if (o.failure) return fallbackToSource(o.failure);
			if (!o.parsed) return;
			doc.adoptParsed(o.parsed);
			// quirk: this records the CURRENT doc.texSource, which may be post-edit text if the user
			// typed while the parse was in flight. harmless: onChange clears the anchor on edits.
			parser.lastParsedSource = doc.texSource;
			visualCollab?.noteFreshParse(); // a full re-parse stamped everything fresh
			// EditorView reacts to the new localValue and swaps state on the existing instance: no remount, no flicker
		});
	}

	// manual save (Ctrl/Cmd+S or the Save button); autosave handles the rest
	const save = () => doc.save();

	let globalSearchRef = $state<GlobalSearch | null>(null);
	// Find in Files panel plumbing lives in lib/workspace/editorCommands.ts
	const searchDeps = {
		setSidebarView: (v: 'explorer' | 'search' | 'scm') => (layout.sidebarView = v),
		openSidebar: () => (layout.sidebarOpen = true),
		isSourceMode: () => modes.mode === 'source',
		focusInput: (seed?: string) => globalSearchRef?.focusInput(seed)
	};
	const openGlobalSearch = () => openSearchPanel(searchDeps);
	const closeGlobalSearch = () => closeSearchPanel(searchDeps);

	// the callback surface WorkspaceMain hands down to the topbar / editor / preview / dock
	const actions = {
		// "Comment" on a selection: reveal the dock's Comments tab with a composer for it. The thread
		// is not written until the first message, so an abandoned composer leaves nothing behind.
		beginComment: (from: number, to: number) => {
			commentsCtl.beginAdd(from, to);
			dockView = 'comments';
			termDock.show();
		},
		// same gesture from the visual editor, which brings its own anchor (see beginAddAnchored)
		beginCommentAnchored: (anchor: CommentAnchor | null) => {
			commentsCtl.beginAddAnchored(anchor);
			if (!commentsCtl.pending) return; // nothing to compose (no file, or an empty anchor)
			dockView = 'comments';
			termDock.show();
		},
		// The visual editor's placement report. Goes through the controller rather than straight onto
		// the set, because this is also the only moment anyone can observe visual placement - so it is
		// what gets recorded to the log for the files nobody has open. Cleared on leaving visual (below).
		visualCommentsPlaced: (lost: string[]) => {
			const file = commentsCtl.activeFile;
			if (file) void commentsCtl.recordHidden(file, new Set(lost));
		},
		/**
		 * A thread was clicked in the editor.
		 *
		 * From the gutter this opens the panel: that mark exists for no other reason than to point at
		 * a comment, so clicking it means "show me it". From source PROSE it only selects - someone
		 * working in their own document happened to land on commented text, and taking over the dock
		 * for that would throw away whatever terminal they were reading; the gutter is right there
		 * for the deliberate gesture. The visual editor HAS no gutter, so its highlight is the only
		 * affordance pointing at the thread and a click on it opens the panel too.
		 */
		selectComment: (id: string, from: 'text' | 'gutter' | 'visual') => {
			commentsCtl.selected = id;
			if (from === 'text') return;
			dockView = 'comments';
			termDock.show();
		},
		submitComment: (body: string) => void commentsCtl.commitAdd(body),
		cancelComment: () => commentsCtl.cancelAdd(),
		openComment: (t: CommentThread) => commentsCtl.open(t),
		replyToComment: (t: CommentThread, body: string) => void commentsCtl.reply(t, body),
		resolveComment: (t: CommentThread, resolved: boolean) => void commentsCtl.setResolved(t, resolved),
		deleteComment: (t: CommentThread) => void commentsCtl.remove(t),
		editCommentMessage: (msg: CommentMessage, body: string) => void commentsCtl.editMessage(msg, body),
		deleteCommentMessage: (t: CommentThread, msg: CommentMessage) => void commentsCtl.removeMessage(t, msg),
		setViewMode,
		syncForward,
		pauseDraft: () => draftCtl.pause(),
		onCaretMove: (line: number, character: number) => onCaretMove(line, character),
		onSaveTypstPdf: () => saveTypstPdf(),
		resumeDraft: () => void draftCtl.resume(),
		requestCompile: () => {
			collabGuest.requestCompile();
			toaster.info({ title: m.session_compile_requested(), duration: 2500 });
		},
		openCompileModal: () => openCompileModal(),
		showProblems: () => {
			showTerminal();
			dockView = 'problems';
		},
		showComments: () => {
			showTerminal();
			dockView = 'comments';
		},
		insertZoteroCitation,
		save: () => save(),
		activateTab,
		closeTab,
		keepTab: (path: string) => tabs.keep(path),
		useSource: () => setViewMode('source'),
		pickStarter,
		newTexFile,
		importStarter: importStarterFiles,
		onTexInput,
		onRawInput,
		onVisualChange: onChange,
		onVisualSelection: () => {
			visualCollab?.publishCursor();
			// visual-mode preview follow; gated here too so no timer churn outside typ+follow
			if (kind === 'typ' && typstScrollTarget() !== null && $settings.typstPreviewFollow === true) sendVisualCaretScroll(null);
		},
		onEditFrontmatter: editPreambleFrontmatter,
		syncToPdf: syncToLine,
		historyStep: workspaceHistoryStep,
		jumpToFile: jumpToInclude,
		openFileAt: openFileAtLine,
		refreshDiff: () => void toastAfter(m.wsview_toast_diff_refreshed(), captureDiffSnapshot),
		exitDiff,
		onPdfDoubleClick,
		onInverseSync: (file: string, line: number, selectText?: string) => openFileAtLine(normSyncPath(file), line, selectText),
		onPreviewSettled: runDraftDecision,
		// Live mode's compile has its own log, and the normal pipeline never sees it -- that one
		// polls the .log of the user's compile command, which does not run in live mode. quiet: a
		// draft compile fires whenever typing pauses, so it may fill the Problems list but must
		// never yank the dock open mid-sentence. The topbar's error badge is the signal.
		onPreviewDiagnostics: async (logPath: string) => {
			// A compile that never reached the engine (lualatex not on PATH) leaves no log to read,
			// and publishLogDiagnostics would throw on the missing file. That case is exactly the one
			// the preview's own banner exists for, so there is nothing to add here.
			const s = await statFile(logPath);
			if (!s.exists) return;
			// the log's OWN mtime, not now(): updatedAt is what tells a reader how old this parse is,
			// and stamping it with the read time made a day-old log look freshly written
			await compiler.publishLogDiagnostics(logPath, s.mtimeMs, true, null);
		},
		toggleTerminalShrink,
		toggleTerminal
	};

	// the callback surface WorkspaceChrome hands to the menu bar and sidebar
	const chromeActions = {
		// the project's compile command, accepted for this folder on this machine. Here rather than
		// in `actions` because its banner is window-wide chrome now, not part of the editor column.
		acceptProjectCommand: () => {
			projectConfig.accept();
			compileCommand = resolveCompileCommand($mainFile);
		},
		newFileOfType: (ext?: string) => newFileOfType(ext),
		openFolder: openFolderFromMenu,
		closeWorkspace,
		save: () => save(),
		openShare: () => (shareModalOpen = true),
		openCompileModal: () => openCompileModal(),
		newTerminal: newTerminalFromMenu,
		toggleTerminal,
		openFormatModal,
		openTutorial: () => (tutorialModalOpen = true),
		uiZoomIn,
		uiZoomOut,
		uiZoomReset,
		refreshTree: () => void toastAfter(m.wsview_toast_tree_refreshed(), refreshTree),
		openGlobalSearch: () => void openGlobalSearch(),
		closeGlobalSearch: () => void closeGlobalSearch(),
		openFileAt: openFileAtLine,
		openEntry,
		// the main file is a property of the project, so it goes in .texpile/config.json with the rest
		setMain: (entry: TreeEntry) => void toggleMainFile(entry.path),
		revealEntry: (entry: TreeEntry) => void revealItem(entry.path),
		refreshGit: () => void toastAfter(m.wsview_toast_git_refreshed(), () => refreshGitStatus(get(workspaceRoot)))
	};

	// the Ctrl+K palette. Registered rather than passed down: it reaches roughly a dozen of these
	// actions, and threading that through WorkspaceChrome and WorkspaceMain to a dialog would touch
	// four files per command. Cleared on destroy so a keystroke after the workspace closed is inert.
	onMount(() => {
		setPaletteActions({
			save: () => save(),
			runCompile: () => compiler.runCompile(),
			stopCompile: () => compiler.stopCompile(),
			isCompiling: () => compiler.compiling,
			// caps.compile, not !guest: being a guest is why the toolchain is absent today, not what
			// is absent. The other four gates below read the capability, so this one does too.
			compileAvailable: () => termDock.available && provider.caps.compile,
			setViewMode,
			getViewMode: () => modes.mode,
			hasFile: () => !!doc.path,
			canManageTree: () => provider.caps.manageTree,
			canSearch: () => provider.caps.search,
			canFormat: () => canFormatDoc(),
			formatTool: () => (kind === 'typ' ? 'typstyle' : 'latexindent'),
			canGit: () => provider.caps.git,
			openFile: (abs) => activeFilePath.set(abs),
			toggleSidebar: () => layout.toggleSidebar(),
			sidebarOpen: () => layout.sidebarOpen,
			toggleTerminal,
			terminalVisible: () => termDock.visible,
			terminalAvailable: () => termDock.available,
			newTerminal: newTerminalFromMenu,
			openCompileModal: () => openCompileModal(),
			openFormatModal,
			openGlobalSearch: () => void openGlobalSearch(),
			openPreferences: () => preferencesOpen.set(true),
			// same condition the app-icon menu uses: desktop only, and never for a guest
			openShareSession: isDesktop() && !guest ? () => (shareModalOpen = true) : undefined,
			newFile: (ext) => newFileOfType(ext),
			openFolder: () => void openFolderFromMenu(),
			refreshTree: () => void refreshTree(),
			openTypstPreview: () => enableTypstPreview(),
			isTypstProject: () => typstProject,
			canZoteroCite,
			insertZoteroCitation
		});
		return () => setPaletteActions(null);
	});

	const uiZoomPercent = $derived(Math.round(($settings.uiZoom ?? 1) * 100));
	// shortcut table + UI zoom live in lib/workspace/shortcuts.ts
	const onKeydown = createKeydownHandler({
		getLoadedPath: () => doc.path,
		closeTab,
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
		{treeOps}
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
			typstProject
		}}
		actions={chromeActions}
		pendingCommand={projectConfig.pending}
		bind:fileTreeRef
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
			{typstPreviewHost}
			{typstPreviewWanted}
			{mainIsTypst}
			guestTypstOffered={guest && collabGuest.typstPreviewOffered}
			{mainUnset}
			onPickMain={() => void openMainConfirm()}
			panes={{
				openTabs: tabs.list,
				previewTab: tabs.preview,
				applyingStarter: starters.applying,
				allReferences,
				sourceGotoLine,
				sourceDiagnostics,
				fileUrl,
				cwd: $workspaceRoot ?? '',
				comments: commentsCtl.threads,
				commentFile: commentsCtl.activeFile,
				commandPending: !!projectConfig.pending,
				commentsOrphaned: commentsCtl.orphaned,
				commentsNotVisible: commentsCtl.notVisible,
				commentFilesPresent,
				commentSelected: commentsCtl.selected,
				commentRanges: commentsCtl.ranges,
				commentPending: commentsCtl.pending,
				zoteroCite: canZoteroCite()
			}}
			{actions}
			bind:dockView
			bind:pdfPaneRef
		/>
	</WorkspaceChrome>

	<ZoteroCitationDialog />

	<WorkspaceModals
		bind:mainPrompt
		{unsaved}
		{external}
		bind:compileSettings
		bind:formatModalOpen
		formatTool={kind === 'typ' ? 'typstyle' : 'latexindent'}
		{formatting}
		{pendingRefUpdate}
		onSaveCompile={saveCompileCommand}
		onUseDefaultCompile={useDefaultCommand}
		onRunCompile={compiler.runCompile}
		onFormat={doRunFormat}
		onResolveConflict={resolveConflict}
		onKeepRefs={() => (pendingRefUpdate = null)}
		onApplyRefs={doApplyRefUpdate}
	/>
</div>

<TutorialConfirmModal bind:open={tutorialModalOpen} onConfirm={openTutorial} />
{#if !guest}
	<SessionShareModal bind:open={shareModalOpen} root={$workspaceRoot} onBeforeStart={() => saver.flushAndWait()} />
{/if}
{#if session.active}
	<VisualCollab bind:this={visualCollab} {session} path={doc.path} {kind} viewMode={modes.mode} api={visualCollabApi} />
{/if}
