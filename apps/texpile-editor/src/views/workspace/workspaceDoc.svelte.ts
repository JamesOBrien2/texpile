// The open document and its parse/mode lifecycle. Single source of truth for a .tex file:
// its raw text (doc.texSource), the whole file. The visual editor is a view over it: entry
// parses into doc.visualDoc + doc.docMeta, every visual edit serializes straight back into
// doc.texSource, and source mode binds to it directly. No rival copy can drift.
import { DocumentBuffer, fileKind, formatOf, hasVisualMode } from '$lib/workspace/documentBuffer.svelte';
import { ViewModeSwitch } from '$lib/workspace/viewModeSwitch.svelte';
import { DiffMode } from '$lib/workspace/diffMode.svelte';
import { FileOpener } from '$lib/workspace/fileOpener';
import { VisualParser, type ParseFailure } from '$lib/workspace/visualParse.svelte';
import { detectMainFile, gatherProjectMacros } from '$lib/workspace/project';
import { workspaceRoot } from '$lib/workspace/workspaceStore';
import { editorViewStore } from '$lib/stores/editorStore';
import type { WorkspaceProvider } from '$lib/workspace/workspaceProvider';
import type { EditSession } from '$lib/collab/editSession';
import type { SavePipeline } from '$lib/workspace/savePipeline.svelte';
import { toaster } from '$lib/modals/toaster-svelte';
import { m } from '$lib/paraglide/messages';

type DocDeps = {
	provider: WorkspaceProvider;
	session: () => EditSession;
	guest: () => boolean;
	visualCollab: () => { noteLocalEdit(): void; noteFreshParse(): void } | null;
	saver: () => SavePipeline;
	/** a jump asked for the incoming file survives the switch; older ones must not */
	clearStaleGoto: (loadedPath: string | null) => void;
};

export class WorkspaceDoc {
	// macro-defining text from the main file's include chain, fed to the parser (see workspace/project.ts)
	projectMacros = $state('');

	// worker parse + sequencing live in lib/workspace/visualParse.svelte.ts
	readonly parser = new VisualParser(() => this.projectMacros);
	readonly doc: DocumentBuffer;
	readonly modes: ViewModeSwitch;
	readonly diff: DiffMode;
	private opener: FileOpener;

	constructor(private d: DocDeps) {
		// the open file's buffers and edit handlers live in lib/workspace/documentBuffer.svelte.ts
		this.doc = new DocumentBuffer({
			scheduleSave: (path, content) => d.saver().schedule(path, content),
			discardQueuedSave: () => d.saver().discard(),
			writeNow: (path, content, force) => void d.saver().enqueue(path, content, true, force),
			rebuildVisual: () => this.rebuildVisualFromSource(),
			isVisualMode: () => this.modes.mode === 'visual',
			noteLocalEdit: () => d.visualCollab()?.noteLocalEdit(),
			clearPendingAnchor: () => (this.modes.pendingVisualAnchor = null)
		});
		// view mode, scroll anchors and cross-mode history live in lib/workspace/viewModeSwitch.svelte.ts
		this.modes = new ViewModeSwitch({
			getKind: () => this.doc.kind,
			getLoadedPath: () => this.doc.path,
			getSource: () => this.doc.texSource,
			setSource: (t) => (this.doc.texSource = t),
			getDocMeta: () => this.doc.docMeta,
			getLastParsedSource: () => this.parser.lastParsedSource,
			rebuildVisual: () => this.rebuildVisualFromSource(),
			captureDiffSnapshot: () => void this.diff.snapshot(),
			scheduleSave: (path, text) => d.saver().schedule(path, text)
		});
		// HEAD-vs-working-copy view; state and snapshotting live in lib/workspace/diffMode.svelte.ts
		// diff view (read-only): committed HEAD vs the live buffer, snapshotted (not bound)
		// on entry / file switch / manual refresh so it never re-diffs per keystroke
		this.diff = new DiffMode({
			getLoadedPath: () => this.doc.path,
			getWorkingText: () => (hasVisualMode(this.doc.kind) ? this.doc.texSource : this.doc.rawContent)
		});
		// opening the active file into the buffers lives in lib/workspace/fileOpener.ts
		this.opener = new FileOpener({
			doc: this.doc,
			parser: this.parser,
			readText: (p) => d.provider.readText(p),
			whenIdle: () => d.saver().whenIdle(),
			isVisualMode: () => this.modes.mode === 'visual',
			isSourceMode: () => this.modes.mode === 'source',
			isDiffMode: () => this.modes.mode === 'diff',
			claimVisualLock: (path) => {
				const session = d.session();
				if (session.active) session.setVisualLock(this.hostHoldsExclusively(fileKind(path), this.modes.mode, path) ? path : null);
			},
			beforeOpen: (path) => d.session().beforeOpen(path),
			// MUST honor the opener's format: it parses BEFORE doc.path switches, so the reactive
			// `kind` (tryParseVisual) still points at the outgoing file and cross-format opens
			// would parse .tex as markdown (and vice versa)
			parse: (text, format) => this.parser.parse(text, format),
			fallbackToSource: (failure) => this.fallbackToSource(failure),
			resetHistory: (text) => this.modes.history.reset(text),
			disableHistory: () => this.modes.history.disable(),
			clearPerFileViewState: () => this.clearPerFileViewState(),
			captureDiffSnapshot: () => void this.diff.snapshot(),
			closeOpenFile: () => this.closeOpenFile()
		});

		// mirror to the global store so menuBarCommands can route Insert/Format;
		// diff is read-only, so routing it as source is harmless
		$effect(() => this.modes.syncStore());
		// the doc.visualDoc dep re-fires this when an async re-parse lands (the doc swap itself is untracked)
		$effect(() => {
			void editorViewStore.current;
			void this.doc.visualDoc;
			void this.modes.pendingVisualAnchor;
			void this.modes.mode;
			this.modes.tryResolvePendingAnchor();
		});
		// guests never enter diff (no disk/git to diff against); visual is fine, it runs on the
		// shared Y.Text like everything else
		$effect(() => {
			if (d.guest() && this.modes.mode === 'diff') this.modes.mode = 'source';
		});
		// shared session: a file the host holds in a NON-Y-bound editor is host-exclusive (guests go
		// read-only), else concurrent guest edits to that file's Y.Text would be clobbered.
		$effect(() => {
			const session = d.session();
			if (!session.active) return;
			session.setVisualLock(this.hostHoldsExclusively(this.doc.kind, this.modes.mode, this.doc.path) ? this.doc.path : null);
		});
		// guests: resolve the main file + cross-file macro context from the shared doc (the host-only
		// initProject never runs for them), re-gathered when the shared file set changes, so visual
		// parses see the project's custom macro signatures and can't mis-serialize a guest edit
		$effect(() => {
			if (!d.guest() || !d.session().active) return;
			void d.session().manifestRev;
			const root = workspaceRoot.current;
			if (!root) return;
			void (async () => {
				try {
					const files = await d.provider.scanTexFiles(root);
					const main = await detectMainFile(files, d.provider.readText);
					const macros = main ? await gatherProjectMacros(main, root, d.provider.readText) : '';
					if (macros === this.projectMacros) return;
					this.projectMacros = macros;
					// signatures changed: a doc parsed without them is stale, re-derive the open one
					this.parser.lastParsedSource = '';
					if (this.doc.path && this.doc.kind === 'tex' && this.modes.mode === 'visual') this.rebuildVisualFromSource();
				} catch {
					this.projectMacros = '';
				}
			})();
		});
	}

	tryParseVisual(text: string) {
		return this.parser.parse(text, formatOf(this.doc.kind));
	}

	/**
	 * A file the host holds in a non-Y-bound editor is host-exclusive. Source mode (tex/bib/text)
	 * is Y-bound and co-edits freely; BOTH visual dialects consume remote edits through the
	 * re-parse patcher (VisualCollab), so only bib held in BibManager still locks - BibManager
	 * isn't wired to the shared doc at all.
	 */
	hostHoldsExclusively(k: string | null, mode: string, path: string | null): boolean {
		if (!path) return false;
		// markdown was listed here only while it had no remote-patch path; VisualCollab now serves
		// both visual dialects, so it co-edits exactly like tex does
		return k === 'bib' && mode !== 'source';
	}

	loadFile(path: string) {
		return this.opener.open(path);
	}

	/** drop the open file's buffers AND the per-file view state that must not leak into the next file */
	closeOpenFile(): void {
		this.doc.close();
		this.clearPerFileViewState();
		this.modes.history.disable();
	}

	/** anchors are keyed to the outgoing file's text; a new file must never inherit them */
	clearPerFileViewState(): void {
		this.modes.sourceScrollAnchor = null;
		this.modes.pendingVisualAnchor = null;
		this.d.clearStaleGoto(this.doc.path);
	}

	fallbackToSource(failure: ParseFailure): void {
		this.modes.mode = 'source';
		this.doc.visualDoc = null;
		this.modes.pendingVisualAnchor = null; // never re-anchor a later visual entry off this failed switch
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

	rebuildVisualFromSource(): void {
		// fast path: source unchanged since the last successful parse, keep the mounted PM view
		if (this.doc.texSource === this.parser.lastParsedSource && this.doc.visualDoc) return;

		const mySeq = this.parser.nextSequence();
		void this.tryParseVisual(this.doc.texSource).then((o) => {
			if (!this.parser.isCurrent(mySeq)) return; // superseded
			if (o.failure) return this.fallbackToSource(o.failure);
			if (!o.parsed) return;
			this.doc.adoptParsed(o.parsed);
			// quirk: this records the CURRENT doc.texSource, which may be post-edit text if the user
			// typed while the parse was in flight. harmless: onChange clears the anchor on edits.
			this.parser.lastParsedSource = this.doc.texSource;
			this.d.visualCollab()?.noteFreshParse(); // a full re-parse stamped everything fresh
			// EditorView reacts to the new localValue and swaps state on the existing instance: no remount, no flicker
		});
	}

	/** manual save (Ctrl/Cmd+S or the Save button); autosave handles the rest */
	save() {
		return this.doc.save();
	}
}
