<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import {
		EditorView,
		keymap,
		drawSelection,
		lineNumbers,
		highlightActiveLine,
		rectangularSelection,
		crosshairCursor
	} from '@codemirror/view';
	import { EditorState, Compartment, Text, Transaction } from '@codemirror/state';
	import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
	import { bracketMatching, indentOnInput, foldGutter, LanguageDescription } from '@codemirror/language';
	import { cmSyntaxHighlight } from '$lib/editor/source/cmHighlight';
	import { languages as cmlangdata } from '@codemirror/language-data';
	import { searchKeymap } from '@codemirror/search';
	import { texpileSearch } from '$lib/editor/source/extensions/search-panel/searchPanel';
	import { latexAutocomplete, latexIntellisense } from '$lib/languages/latex/intellisense/intellisense';
	import { foldMarkerDom, foldMarkerTheme } from '$lib/languages/latex/intellisense/fold';
	import { mdSourceShortcuts } from '$lib/languages/markdown/source/sourceExtensions';
	import { typSourceShortcuts } from '$lib/languages/typst/source/sourceExtensions';
	import { mdPathCompletion } from '$lib/languages/markdown/pathCompletion';
	import { cmSpellcheck } from '$lib/editor/spellcheck/cmSpellcheck';
	import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
	import {
		comments,
		setCommentRanges,
		focusCommentThread,
		commentGutterHandlers,
		type CommentRange
	} from '$lib/editor/visual/extensions/comments';
	import { mathPreview } from '$lib/editor/source/extensions/math-preview/mathPreview';
	import { starterGhost } from '$lib/editor/source/extensions/starter-ghost/starterGhost';
	import { synctexFlash, flashLineEffect } from '$lib/languages/latex/source/synctexFlash';
	import { bindModalKeymap, modalKeymapCompartment } from '$lib/editor/source/extensions/keybindings/modalKeymap';
	import { bibtex } from '$lib/languages/bib/bibtexLanguage';
	import { latex } from '$lib/languages/latex/source/latexLanguage';
	import { releaseTypstLsp, typstLspExtension, typstServerGen } from '$lib/languages/typst/intellisense/lspClient';
	import { typstGuestLspExtension, releaseGuestTypstLsp } from '$lib/languages/typst/intellisense/guestLspExtension';
	import { collabGuest } from '$lib/collab/guestStore.svelte';
	import { guestSession } from '$lib/collab/guestSession';
	import { guestRelPath } from '$lib/collab/sessionProvider';
	import { workspaceRoot } from '$lib/workspace/workspaceStore';
	import { sourceCmView } from '$lib/stores/editorStore';
	import { docText } from '$lib/editor/source/docText';
	import { minimalEdit } from '$lib/editor/source/minimalEdit';
	import { caretDoctor, logDocReplace } from '$lib/debug/caretDoctor';
	import { setSourceDocCount, setSourceSelectionCount } from '$lib/stores/countStore.svelte';
	import { trailingDebounce } from '$lib/trailingDebounce';
	import { docPositions, resolvePosition } from '$lib/workspace/docPositions';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/settings';
	import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
	import * as Y from 'yjs';
	import type { Awareness } from 'y-protocols/awareness';
	import SourceRightClickMenu from '$lib/editor/source/SourceRightClickMenu.svelte';

	// gotoLine: token makes repeat jumps to the same line re-fire; selectText anchors against line drift.
	// initialScrollPos: one-shot mode-switch sync applied at mount.
	// onHistoryBoundary: called when CM undo/redo is exhausted; return true if the workspace history handled it.
	// diagnostics: compile-log problems for this file, line-anchored (the log gives no columns).
	type SourceDiagnostic = {
		line: number;
		lineEnd?: number;
		severity: 'error' | 'warning' | 'info';
		message: string;
		/** 1-based column of the error point (from the log's l.NN context). */
		column?: number;
		/** source text just before the error point, or the offending \ref/\cite key. */
		anchorText?: string;
		/** the offending \command, sized for the underline when found on the line. */
		token?: string;
	};
	// shared-session binding: the Y.Text is the doc (value is ignored), remote cursors render via
	// awareness, undo becomes CRDT-aware (only your own edits).
	type CollabBinding = {
		ytext: Y.Text;
		awareness: Awareness;
		readOnly?: boolean;
	};
	let {
		value = '',
		onInput,
		filename = '',
		docPath = null,
		gotoLine,
		onSyncToPdf,
		initialScrollPos = null,
		onHistoryBoundary,
		diagnostics = [],
		onJumpToFile,
		onOpenFileAt,
		collab = null,
		onCaretMove,
		commentRanges = [],
		selectedComment = null,
		onAddComment,
		onInsertCitation,
		onSelectComment
	}: {
		value?: string;
		onInput?: (v: string) => void;
		filename?: string;
		/** absolute path, for remembering this file's caret across tab switches */
		docPath?: string | null;
		gotoLine?: { line: number; token: number; selectText?: string };
		onSyncToPdf?: (line: number) => void;
		initialScrollPos?: { scroll: number | null; cursor: number | null } | null;
		onHistoryBoundary?: (dir: 'undo' | 'redo') => boolean;
		diagnostics?: SourceDiagnostic[];
		/** go-to-definition hooks: \input targets and cross-file definition jumps */
		onJumpToFile?: (name: string) => void;
		onOpenFileAt?: (file: string, line: number) => void;
		collab?: CollabBinding | null;
		/** ZERO-based line and column; fires on column moves too, because tinymist's jump_from_cursor
		 *  reads the leaf BEFORE the cursor and never resolves at column 0. consumers debounce. */
		onCaretMove?: (line: number, character: number) => void;
		/** review-comment ranges already resolved against this text; see lib/comments */
		commentRanges?: CommentRange[];
		/** the thread the reader is looking at; its highlight is picked out from the rest */
		selectedComment?: string | null;
		/** the reader selected text and pressed Comment; offsets are into this document */
		onAddComment?: (from: number, to: number) => void;
		/** pick citations from Zotero and insert them at the caret (host + desktop only) */
		onInsertCitation?: () => void;
		onSelectComment?: (id: string, from: 'text' | 'gutter') => void;
	} = $props();

	/** last position reported to onCaretMove, so redundant selection updates do not spray requests */
	let lastCaretLine = -1;
	let lastCaretChar = -1;

	// language/extension gating: EditorPane only passes docPath, so `filename` alone was always
	// '' and EVERY file (md, bib) silently fell into the "no name -> assume LaTeX" branch —
	// latex intellisense shortcuts and highlighting in markdown source mode included
	const fileFor = $derived(filename || docPath || '');
	const isTypFile = $derived(/\.typ$/i.test(fileFor));

	let rightClick: { open: (event: MouseEvent, on: EditorView) => void } | undefined;

	let host = $state<HTMLDivElement>();
	let view: EditorView | null = null;
	// flat markers; CM's stock ones are gradient blobs. colours baked in, data: URIs can't reach CSS vars
	function lintMarker(svg: string) {
		return `url('data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${svg}</svg>`)}')`;
	}
	const gutterTheme = EditorView.theme({
		// gutters aren't content: without this, double-clicking a line number or a fold arrow selects it
		'.cm-gutters': { userSelect: 'none', WebkitUserSelect: 'none' },
		// tight padding: this cell sits BETWEEN the lint and fold rails, which carry their own.
		// three digits of floor so the text stops shifting every power of ten
		'.cm-lineNumbers .cm-gutterElement': {
			padding: '0 2px 0 3px',
			minWidth: 'calc(3ch + 2px + 3px)',
			textAlign: 'center'
		},
		'.cm-gutter-lint': { width: '1em' },
		// pinned: a gutter is as wide as its widest marker, so the text would slide sideways the
		// moment the first parse produced fold ranges
		'.cm-foldGutter': { width: '14px' },
		// flex-centre: stock CM leaves the marker inline, sitting above the line-number baseline
		'.cm-gutter-lint .cm-gutterElement': { padding: '0 1px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
		'.cm-lint-marker': { width: '0.7em', height: '0.7em' },
		'.cm-lint-marker-error': { content: lintMarker('<circle cx="20" cy="20" r="15" fill="#ef4444"/>') },
		'.cm-lint-marker-warning': { content: lintMarker('<circle cx="20" cy="20" r="15" fill="#f59e0b"/>') },
		'.cm-lint-marker-info': { content: lintMarker('<circle cx="20" cy="20" r="15" fill="#3b82f6"/>') }
	});
	// y-codemirror.next's stock theme shifts text: its line selections and caret trade padding for
	// margins that do not cancel out. pin both so a peer's cursor can never move a glyph on this screen
	const yRemoteLayoutFix = EditorView.theme({
		'.cm-yLineSelection': { margin: '0', padding: '0 2px 0 6px' },
		'.cm-ySelectionCaret': { border: 'none', margin: '0' },
		'.cm-ySelectionCaret::before': {
			content: "''",
			position: 'absolute',
			top: '0',
			bottom: '0',
			left: '-1px',
			width: '2px',
			backgroundColor: 'inherit'
		}
	});
	const langConf = new Compartment();
	const roConf = new Compartment();
	// soft wrap is a compartment, not a mounted-once extension: toggling it in Preferences has to
	// take effect in the editor already on screen, and remounting would lose the caret and scroll
	const wrapConf = new Compartment();
	// a compartment, so the editor mounts and is typeable before the server answers, or never does
	const lspConf = new Compartment();
	// attached to THIS editor, which makes it the owner of the lint state (see the diagnostics effect)
	let typstLspActive = false;
	// same meaning for squiggle ownership; tracked apart only because the two release differently
	let typstGuestLspActive = false;

	// vim / emacs bindings, filled in after mount because the packages are dynamically imported
	const keymapConf = modalKeymapCompartment();
	let unbindKeymap: (() => void) | null = null;
	// true while pushing an external value into CM, so the update listener doesn't echo it back as a user edit
	let syncing = false;
	// last text handed to onInput: the value-sync effect compares against this first, so our own
	// round-tripped edits skip the second full doc.toString() per keystroke
	let lastEmitted: string | null = null;
	const deferredDocCount = trailingDebounce(300, setSourceDocCount);

	// cached as it moves, because onDestroy IS the tab switch and can run detached, where
	// getBoundingClientRect reads all zeros and every line resolves to line 1
	let lastVisibleLine = 1;
	let lastVisibleOffset = 0;
	function captureVisibleLine(): void {
		if (!view) return;
		const rect = view.scrollDOM.getBoundingClientRect();
		if (rect.height === 0) return; // detached or hidden: the last good value stands
		const topH = rect.top - view.documentTop; // viewport top, in document height coordinates
		const block = view.lineBlockAtHeight(topH);
		lastVisibleLine = view.state.doc.lineAt(Math.min(block.from, view.state.doc.length)).number;
		// how far INTO that line the viewport starts, which is what makes the restore exact rather
		// than snapped to a line boundary
		lastVisibleOffset = Math.max(0, Math.round(topH - block.top));
	}

	/** Snapshot the caret and first visible line for docPositions. Line/column rather than an
	 *  offset: this file can change on disk between sessions, and a line survives that far better.
	 *  Collab is excluded - the Y.Text is the document and positions there are not ours to assert. */
	function rememberPosition(): void {
		if (!view || !docPath || collab) return;
		captureVisibleLine();
		const head = view.state.selection.main.head;
		const line = view.state.doc.lineAt(head);
		docPositions.set(docPath, {
			row: line.number - 1,
			column: head - line.from,
			firstVisibleLine: lastVisibleLine,
			offset: lastVisibleOffset
		});
	}
	// throttle-ish: scrolling and arrow keys fire constantly, and only the resting place matters
	const deferredRememberPosition = trailingDebounce<void>(400, rememberPosition);
	// reads the selection at fire time (not capture), so a huge selection isn't sliced per keystroke
	const deferredSelectionCount = trailingDebounce<void>(150, () => {
		if (!view) return;
		const s = view.state.selection.main;
		setSourceSelectionCount(s.empty ? null : view.state.sliceDoc(s.from, s.to));
	});
	// held at component scope so onDestroy can tear it down (else its doc observer leaks across
	// every file switch / mode toggle that remounts this editor)
	let undoManager: Y.UndoManager | null = null;

	onMount(() => {
		// collab mode: the Y.Text is the document, CRDT undo replaces CM history (plain CM undo
		// would revert other people's edits)
		undoManager = collab ? new Y.UndoManager(collab.ytext) : null;
		const initialDoc = collab ? collab.ytext.toString() : value;
		// folded into EditorState.create, not dispatched after mount, so the first paint is already
		// in the right place. a mode-switch anchor outranks it, and gotoLine outranks both
		const saved = !collab && !initialScrollPos && docPath ? docPositions.get(docPath) : null;
		// Text.of, not a throwaway EditorState, which would parse the whole paper twice per open
		const restored = saved ? resolvePosition(saved, Text.of(initialDoc.split('\n'))) : null;
		view = new EditorView({
			parent: host,
			...(restored ? { scrollTo: EditorView.scrollIntoView(restored.scroll, { y: 'start', yMargin: 0 }) } : {}),
			state: EditorState.create({
				doc: initialDoc,
				...(restored ? { selection: { anchor: restored.cursor } } : {}),
				extensions: [
					// gutters render in extension order: lint goes before lineNumbers so it lands on their left
					...(!fileFor || /\.(tex|typ)$/i.test(fileFor) ? [lintGutter({ hoverTime: 0 })] : []),
					// mounted only where the caller wants comments, so .bib and plain-text editors do not
					// grow a gutter column for a feature they never show
					...(onAddComment
						? [
								comments({
									onAdd: (from, to) => onAddComment?.(from, to),
									onSelect: (id, from) => onSelectComment?.(id, from),
									addLabel: m.comments_add()
								})
							]
						: []),
					// the comment mark rides these cells (gutterLineClass), so the click on it has to be
					// handled by the gutter that owns them - EditorView.domEventHandlers only sees the text
					lineNumbers(onSelectComment ? { domEventHandlers: commentGutterHandlers((id) => onSelectComment(id, 'gutter')) } : {}),
					gutterTheme,
					highlightActiveLine(),
					...(collab ? [yCollab(collab.ytext, collab.awareness, { undoManager: undoManager! }), yRemoteLayoutFix] : [history()]),
					roConf.of(collab?.readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
					keymapConf.of([]),
					drawSelection(),
					// multiple cursors: the keymaps already bind the commands, but every transaction is
					// normalized down to one range until the state allows extra ones
					EditorState.allowMultipleSelections.of(true),
					rectangularSelection(),
					crosshairCursor(),
					bracketMatching(),
					indentOnInput(),
					langConf.of([]),
					cmSyntaxHighlight(),
					// guests included: the sources read stores fed through the workspace provider, so a
					// session serves them from the shared doc
					...(!fileFor || /\.tex$/i.test(fileFor)
						? [latexIntellisense({ onJumpToFile, onOpenFileAt }), mathPreview(), starterGhost(), cmSpellcheck()]
						: /\.(md|markdown)$/i.test(fileFor)
							? // md chords; $-math, spellcheck and project file paths are dialect-free
								[mdSourceShortcuts(), mdPathCompletion(), mathPreview(), cmSpellcheck()]
							: /\.bib$/i.test(fileFor)
								? [latexAutocomplete({ bib: true })]
								: /\.typ$/i.test(fileFor)
									? // completion/hover/diagnostics arrive over LSP, filled into lspConf below. the fold
										// RAIL is mounted here rather than with the language, whose parser is a dynamic
										// import: a gutter arriving a second late shoves the text sideways on every open
										[typSourceShortcuts(), cmSpellcheck('typst'), foldGutter({ markerDOM: foldMarkerDom }), foldMarkerTheme]
									: []),
					lspConf.of([]),
					synctexFlash(), // flash the line jumped to by SyncTeX inverse search / Find-in-Files
					// compact find/replace widget, floated top-right (styles below)
					texpileSearch(),
					keymap.of([...defaultKeymap, ...(collab ? yUndoManagerKeymap : historyKeymap), ...searchKeymap, indentWithTab]),
					// lower precedence than historyKeymap, so CM's own undo/redo runs first; these fire only
					// when it's exhausted and the workspace snapshot history takes over. consume the key even
					// at the stack edge: a failed redo falling through to another binding is worse than a no-op.
					// collab mode: the CRDT undo manager owns the whole stack, never fall through.
					keymap.of(
						collab
							? []
							: [
									{ key: 'Mod-z', run: () => (onHistoryBoundary ? (onHistoryBoundary('undo'), true) : false) },
									{ key: 'Mod-y', run: () => (onHistoryBoundary ? (onHistoryBoundary('redo'), true) : false) },
									{ key: 'Mod-Shift-z', run: () => (onHistoryBoundary ? (onHistoryBoundary('redo'), true) : false) }
								]
					),
					wrapConf.of($settings.sourceLineWrap === false ? [] : EditorView.lineWrapping),
					// opt-in diagnostic for "the caret moved and I didn't move it"; see caretDoctor
					caretDoctor(),
					EditorView.contentAttributes.of({ spellcheck: 'false', 'data-gramm': 'false', 'data-enable-grammarly': 'false' }),
					// scrolling produces no ViewUpdate at all, so the update listener below never sees it
					EditorView.domEventHandlers({ scroll: () => deferredRememberPosition() }),
					EditorView.updateListener.of((u) => {
						if (u.docChanged) {
							const text = docText(u.state.doc);
							if (!syncing) {
								lastEmitted = text;
								onInput?.(text);
							}
							deferredDocCount(text); // word/char count is display-only, off the keystroke path
						}
						if (u.docChanged || u.selectionSet) deferredSelectionCount();
						if (u.selectionSet && onCaretMove) {
							const head = u.state.selection.main.head;
							const docLine = u.state.doc.lineAt(head);
							const line = docLine.number - 1;
							// UTF-16 code units from the line start, which is what LSP positions want
							// and what CodeMirror's offsets already are
							const character = head - docLine.from;
							if (line !== lastCaretLine || character !== lastCaretChar) {
								lastCaretLine = line;
								lastCaretChar = character;
								onCaretMove(line, character);
							}
						}
						if (u.selectionSet || u.docChanged || u.geometryChanged) deferredRememberPosition();
					})
				]
			})
		});
		window.texpile.debug.codemirror = view;
		view.focus();
		// adds the remembered fraction of the line back, so the restore is not snapped to a line
		// boundary. a frame late because the height is only known once CM has measured it
		if (restored && saved?.offset) {
			const px = saved.offset;
			requestAnimationFrame(() => {
				if (!view) return;
				const block = view.lineBlockAt(restored.scroll);
				view.scrollDOM.scrollTop += Math.min(px, Math.max(0, block.height - 1));
			});
		}
		unbindKeymap = bindModalKeymap(view, keymapConf);
		// collab mount: the Y.Text may be ahead of the caller's value (guest edits landed while
		// the file was closed) — hand the truth back so the save pipeline starts aligned
		if (collab && onInput && collab.ytext.toString() !== value) onInput(collab.ytext.toString());
		// seed the counts now; the updateListener only fires on later changes
		setSourceDocCount(docText(view.state.doc));
		setSourceSelectionCount(null);
		// mode-switch sync: reveal the scroll offset near the top, park the caret at the
		// visual editor's caret and flash its line
		if (initialScrollPos != null) {
			const len = view.state.doc.length;
			function clamp(p: number) {
				return Math.min(Math.max(0, p), len);
			}
			const scrollPos = initialScrollPos.scroll != null ? clamp(initialScrollPos.scroll) : null;
			const cursorPos = initialScrollPos.cursor != null ? clamp(initialScrollPos.cursor) : scrollPos;
			if (cursorPos != null) {
				view.dispatch({
					selection: { anchor: cursorPos },
					effects: [flashLineEffect.of(cursorPos), EditorView.scrollIntoView(scrollPos ?? cursorPos, { y: 'start', yMargin: 12 })]
				});
			}
		}
		// publish this CM as the source-mode editor so menuBarCommands can route Insert/Format to it
		sourceCmView.set(view);

		// language-data ships no .bib mode, and its LaTeX descriptor matches only .tex/.ltx, so
		// .cls/.sty are routed by hand rather than through matchFilename
		if (fileFor && /\.bib$/i.test(fileFor)) {
			view?.dispatch({ effects: langConf.reconfigure(bibtex()) });
		} else if (fileFor && /\.typ$/i.test(fileFor)) {
			// the typst-syntax crate as wasm, dynamically imported: ~310KB nothing else needs
			void import('$lib/languages/typst/source/typstLanguage').then(({ typstLanguage }) =>
				view?.dispatch({ effects: langConf.reconfigure(typstLanguage()) })
			);
		} else if (!fileFor || /\.(tex|cls|sty)$/i.test(fileFor)) {
			// ours, not language-data's stex, which files nearly everything under a tag the shared
			// style leaves uncoloured
			view?.dispatch({ effects: langConf.reconfigure(latex()) });
		} else {
			const desc = LanguageDescription.matchFilename(cmlangdata, fileFor);
			desc?.load().then((lang) => view?.dispatch({ effects: langConf.reconfigure(lang) }));
		}

		// never awaited: a missing or slow tinymist must not delay the editor appearing. started by
		// the FILE, not the compile command, so a Makefile-driven Typst project still gets intellisense
		armTypstLsp();
	});

	function armTypstLsp(): void {
		if (!fileFor || !/\.typ$/i.test(fileFor)) return;
		// A guest has no toolchain and no project on disk; the host answers instead, over the
		// session. Its paths are already manifest-relative, which is what the host maps back.
		if (guestSession.active) {
			if (typstGuestLspActive) return;
			// strip the synthetic 'session' root; the host joins what we send onto its REAL one
			const rel = guestRelPath(fileFor);
			if (!rel) return;
			// claimed before the await, so a second effect run cannot attach a duplicate. released
			// again on any path that does not end up attached
			typstGuestLspActive = true;
			void typstGuestLspExtension(collabGuest.lspPort(), rel).then((ext) => {
				if (!ext) {
					typstGuestLspActive = false;
					return;
				}
				if (!view) {
					typstGuestLspActive = false;
					releaseGuestTypstLsp();
					return;
				}
				view.dispatch({ effects: lspConf.reconfigure(ext) });
			});
			return;
		}
		void typstLspExtension(get(workspaceRoot), fileFor)
			.then((ext) => {
				if (!ext) return;
				if (!view) {
					// resolved after this editor was destroyed: hand the reference straight back,
					// or the server would count a holder no unmount can ever release
					releaseTypstLsp();
					return;
				}
				typstLspActive = true;
				view.dispatch({ effects: lspConf.reconfigure(ext) });
			})
			.catch(() => {
				/* no intellisense; highlighting and compiling are unaffected */
			});
	}

	// the server died and restarted, so the mounted extension is bound to a dead client. acts on a
	// gen INCREASE only; the first run just records where the counter stands
	let seenTypstGen: number | null = null;
	$effect(() => {
		const gen = $typstServerGen;
		if (seenTypstGen === null || gen === seenTypstGen) {
			seenTypstGen = gen;
			return;
		}
		seenTypstGen = gen;
		if (!view || !fileFor || !/\.typ$/i.test(fileFor)) return;
		typstLspActive = false; // its holder died with the server; armTypstLsp takes a fresh one
		view.dispatch({ effects: lspConf.reconfigure([]) });
		armTypstLsp();
	});

	// follow the Preferences toggle in the open editor rather than only at mount
	$effect(() => {
		const wrap = $settings.sourceLineWrap !== false;
		view?.dispatch({ effects: wrapConf.reconfigure(wrap ? EditorView.lineWrapping : []) });
	});

	// Reconcile an external value change into the document without echoing. addToHistory(false)
	// keeps it out of CM's undo stack, otherwise the next Ctrl+Z would "undo the undo" and bounce
	// back. collab mode: the Y.Text is the document, external value pushes would fight the CRDT.
	//
	// minimalEdit, not a whole-buffer swap: a change spanning every position leaves CodeMirror
	// nothing to map the caret onto, so any external push while typing threw away your place
	$effect(() => {
		const v = value;
		if (!collab && view && v !== lastEmitted && v !== docText(view.state.doc)) {
			const old = docText(view.state.doc);
			const edit = minimalEdit(old, v);
			logDocReplace({
				oldLen: old.length,
				newLen: v.length,
				from: edit.from,
				to: edit.to,
				insertLen: edit.insert.length,
				caret: view.state.selection.main.head
			});
			syncing = true;
			view.dispatch({ changes: edit, annotations: Transaction.addToHistory.of(false) });
			syncing = false;
		}
		// mirror CM's doc after every reconciliation, whichever branch ran, so lastEmitted can
		// never go stale and wrongly short-circuit a later external push
		if (!collab && view) lastEmitted = v;
	});

	// live read-only flips (the host opened/closed this file in its visual editor)
	$effect(() => {
		const ro = collab?.readOnly ?? false;
		void ro;
		if (view && collab) {
			view.dispatch({ effects: roConf.reconfigure(ro ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []) });
		}
	});

	// narrows a line-level diagnostic to the offending token: the anchor text (the log's l.NN
	// context tail, or a \ref/\cite key) re-locates the error point even when the buffer drifted
	// since the compile; the raw column is the fallback, the whole line the last resort.
	function diagnosticRange(doc: EditorState['doc'], d: SourceDiagnostic): { from: number; to: number } {
		const startLine = doc.line(Math.min(d.line, doc.lines));
		const endLine = doc.line(Math.min(d.lineEnd ?? d.line, doc.lines));
		if (d.lineEnd === undefined) {
			if (d.anchorText) {
				const at = startLine.text.indexOf(d.anchorText);
				if (at !== -1) {
					// a \ref/\cite key anchors ON itself
					if (d.token === undefined && !d.anchorText.includes('\\')) {
						return { from: startLine.from + at, to: startLine.from + at + d.anchorText.length };
					}
					// an l.NN tail ENDS at the error point: the offending token is its last chars
					const errPoint = at + d.anchorText.length;
					const len = Math.max(1, d.token?.length ?? 1);
					const from = startLine.from + Math.max(at, errPoint - len);
					return { from, to: Math.min(startLine.to, startLine.from + errPoint) };
				}
			}
			if (d.column !== undefined && d.column - 1 <= startLine.length) {
				const from = startLine.from + Math.max(0, d.column - 1 - Math.max(0, d.token?.length ?? 0));
				return { from, to: Math.min(startLine.to, from + Math.max(1, d.token?.length ?? 1)) };
			}
		}
		return { from: startLine.from, to: Math.max(endLine.to, startLine.from) };
	}

	// declared after the value-sync effect, so a same-flush file switch replaces the document first.
	// dispatched on identity change only: CM maps the ranges itself, and re-dispatching discards that
	let lastRanges: CommentRange[] | null = null;
	$effect(() => {
		const list = commentRanges;
		const v = view;
		if (!v || !onAddComment || list === lastRanges) return;
		lastRanges = list;
		// a list that does not fit was resolved against some other text and stays wrong for this doc
		// forever; consumed but not dispatched, so the field keeps what CM has been mapping
		if (list.some((r) => r.from < 0 || r.to > v.state.doc.length)) return;
		v.dispatch({ effects: setCommentRanges.of(list) });
	});

	// kept apart from the ranges: selecting happens far more often and must not rebuild the whole set
	let lastFocus: string | null = null;
	$effect(() => {
		const id = selectedComment ?? null;
		const v = view;
		if (!v || !onAddComment || id === lastFocus) return;
		lastFocus = id;
		v.dispatch({ effects: focusCommentThread.of(id) });
	});

	// the effect still runs per keystroke (value is a dependency), but dispatching setDiagnostics
	// re-runs every StateField, so skip when nothing can change: empty mapped onto empty, or the
	// same list on an unchanged doc (re-anchoring only matters once either of them moved).
	let lastDiagDoc: EditorState['doc'] | null = null;
	let lastDiagList: SourceDiagnostic[] | null = null;
	let lastDiagEmpty = true;
	$effect(() => {
		const list = diagnostics;
		const v = view;
		void value; // re-anchor when the document is externally replaced
		if (!v) return;
		// setDiagnostics REPLACES the whole lint state, so with a server attached the two writers
		// would overwrite each other. the server owns the squiggles; the compile log keeps Problems
		if (typstLspActive || typstGuestLspActive) return;
		const doc = v.state.doc;
		const valid = list.filter((d) => Number.isInteger(d.line) && d.line >= 1);
		if (valid.length === 0 && lastDiagEmpty) return;
		if (list === lastDiagList && doc === lastDiagDoc) return;
		const mapped: Diagnostic[] = valid.map((d) => ({
			...diagnosticRange(doc, d),
			severity: d.severity,
			message: d.message,
			source: 'latex'
		}));
		v.dispatch(setDiagnostics(v.state, mapped));
		lastDiagDoc = doc;
		lastDiagList = list;
		lastDiagEmpty = mapped.length === 0;
	});

	// SyncTeX gives only a line number, which is stale whenever the buffer differs from the compiled
	// .tex. when the double-clicked word is known, anchor on content instead: select it on the
	// reported line, else on the nearest line containing it. this is what survives line drift.
	function resolveTarget(doc: EditorState['doc'], req: { line: number; selectText?: string }): { from: number; to: number } {
		const line = Math.min(Math.max(1, Math.floor(req.line)), doc.lines);
		const word = req.selectText?.trim();
		if (word && word.length >= 2) {
			const here = doc.line(line);
			const at = here.text.indexOf(word);
			if (at !== -1) return { from: here.from + at, to: here.from + at + word.length };
			// line drifted, find every line containing the word
			const hits: { line: number; from: number }[] = [];
			for (let i = 1; i <= doc.lines; i++) {
				const l = doc.line(i);
				const idx = l.text.indexOf(word);
				if (idx !== -1) hits.push({ line: i, from: l.from + idx });
			}
			if (hits.length === 1) return { from: hits[0].from, to: hits[0].from + word.length }; // unique -> certain
			if (hits.length > 1) {
				const best = hits.reduce((b, h) => (Math.abs(h.line - line) < Math.abs(b.line - line) ? h : b));
				return { from: best.from, to: best.from + word.length };
			}
		}
		const pos = doc.line(line).from;
		return { from: pos, to: pos };
	}
	// the token has to be CHECKED, not just carried: the prop arrives inside an inline object
	// literal, so a save or a compile re-runs this effect and would re-apply the last jump
	let lastGotoToken: number | null = null;
	$effect(() => {
		const req = gotoLine;
		if (!req || !view) return;
		if (req.token === lastGotoToken) return;
		lastGotoToken = req.token;
		const { from, to } = resolveTarget(view.state.doc, req);
		view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true, effects: flashLineEffect.of(from) });
		view.focus();
	});

	onDestroy(() => {
		// this teardown IS the tab switch: last chance to record where the user was, and the
		// debounce below is about to be cancelled, so take the snapshot synchronously first
		rememberPosition();
		sourceCmView.set(null);
		// the language server holds ~90MB with a project open; hand back our reference so it can be
		// reclaimed once no .typ editor is left (it lingers briefly, so a file switch never restarts it)
		if (typstLspActive) {
			typstLspActive = false;
			releaseTypstLsp();
		}
		if (typstGuestLspActive) {
			typstGuestLspActive = false;
			releaseGuestTypstLsp();
		}
		unbindKeymap?.();
		unbindKeymap = null;
		// collab teardown: drop our cursor from awareness so peers don't see a ghost, and reap the
		// undo manager's doc observer before the view goes
		if (collab) collab.awareness.setLocalStateField('cursor', null);
		undoManager?.clear();
		undoManager?.destroy();
		undoManager = null;
		view?.destroy();
		view = null;
		// stale timers must not write the NEXT file's counts into the shared store
		deferredDocCount.cancel();
		deferredSelectionCount.cancel();
		deferredRememberPosition.cancel();
	});
</script>

<div bind:this={host} class="source-editor h-full" oncontextmenu={(e) => view && rightClick?.open(e, view)} role="presentation"></div>

<SourceRightClickMenu bind:this={rightClick} {onSyncToPdf} {onAddComment} {onInsertCitation} syncTarget={isTypFile ? 'preview' : 'pdf'} />

<style>
	.source-editor :global(.cm-editor) {
		height: 100%;
		font-size: 0.875rem;
		position: relative; /* anchor the floating top-right search panel */
	}
	/* float texpileSearch's panel top-right as the same card the visual editor's find bar uses
	   (SearchBar.svelte), so the two search UIs stay consistent */
	.source-editor :global(.cm-panels.cm-panels-top) {
		position: absolute;
		top: 0.5rem;
		right: 0.75rem;
		left: auto;
		width: max-content;
		max-width: calc(100% - 1.5rem);
		background: var(--color-surface-50);
		border: 1px solid var(--color-surface-200);
		border-radius: var(--radius-container, 0.75rem);
		box-shadow:
			0 20px 25px -5px rgb(0 0 0 / 0.1),
			0 8px 10px -6px rgb(0 0 0 / 0.1);
		z-index: 20;
		overflow: hidden;
	}
	:global([data-mode='dark'] .source-editor .cm-panels.cm-panels-top) {
		background: var(--color-surface-950);
		border-color: var(--color-surface-800);
	}
	/* same amber scale the ProseMirror search uses (SearchBar.svelte) */
	.source-editor :global(.cm-searchMatch) {
		background-color: rgb(255, 237, 153);
	}
	.source-editor :global(.cm-searchMatch-selected) {
		background-color: rgb(255, 213, 79);
	}
	:global([data-mode='dark'] .source-editor .cm-searchMatch) {
		background-color: rgb(102, 77, 3);
	}
	:global([data-mode='dark'] .source-editor .cm-searchMatch-selected) {
		background-color: rgb(161, 123, 5);
	}
	.source-editor :global(.cm-scroller) {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		line-height: 1.6;
	}
	.source-editor :global(.cm-content) {
		padding: 1rem 0;
	}
	.source-editor :global(.cm-focused) {
		outline: none;
	}
	/* vim / emacs mode line. Unlike the search widget above this is a BOTTOM panel, so it keeps
	   CodeMirror's normal in-flow layout (the scroller shrinks for it) and only needs skinning. */
	.source-editor :global(.cm-panels.cm-panels-bottom) {
		border-top: 1px solid var(--color-surface-200);
		background: var(--color-surface-100);
	}
	:global([data-mode='dark'] .source-editor .cm-panels.cm-panels-bottom) {
		border-top-color: var(--color-surface-800);
		background: var(--color-surface-900);
	}
	.source-editor :global(.cm-vim-panel) {
		font-size: 0.75rem;
		align-items: center;
		min-height: 1.6em;
	}
</style>
