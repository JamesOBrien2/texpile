// The resolved compile command and everything that follows it around: the project config
// adopt, the per-engine Problems lane, the shared-session compile intel, and loading an
// existing log on folder open.
import { untrack } from 'svelte';
import { fromStore, get } from 'svelte/store';
import { compileLog } from '$lib/stores/compileLogStore';
import {
	shareCompileState as shareHostCompileState,
	guestCompileLog,
	guestDiagnosticsFor,
	hostDiagnosticsFor
} from '$lib/collab/compileIntelBridge';
import { projectConfigSync as projectConfig } from '$lib/workspace/projectConfigSync.svelte';
import { resolveCompileCommand, type CompilePipeline } from '$lib/workspace/compilePipeline.svelte';
import { workspaceRoot, texFiles, mainFile, effectiveCompileFormat } from '$lib/workspace/workspaceStore';
import { isTypstCommand } from '$lib/workspace/typstCommand';
import type { TypstPreviewController } from '$lib/languages/typst/preview/previewController.svelte';
import type { EditSession } from '$lib/collab/editSession';
import type { DocumentBuffer } from '$lib/workspace/documentBuffer.svelte';

type CompileStateDeps = {
	doc: DocumentBuffer;
	guest: () => boolean;
	session: () => EditSession;
	compiler: () => CompilePipeline;
	typstPreview: () => TypstPreviewController;
	statFile: (p: string) => Promise<{ exists: boolean; size: number; mtimeMs: number }>;
};

export class WorkspaceCompileState {
	// the compile command; {main} expands to the main file's path
	command = $state('');

	#root = fromStore(workspaceRoot);
	#main = fromStore(mainFile);
	#texFiles = fromStore(texFiles);
	#log = fromStore(compileLog);

	// Problems are per-engine: switching the main between LaTeX and Typst would otherwise leave the
	// old engine's entries on the panel until the next compile happens to overwrite them. Cleared on
	// the lane change and re-shared, so a session's guests drop them at the same moment. Host-only:
	// a guest's panel mirrors the host's shared intel, never its own lane.
	private problemsLane = effectiveCompileFormat(get(mainFile));
	// share the current pdf + log once when we start hosting (see CompilePipeline.shareExistingOutputs)
	private outputsSharedForSession = false;
	private existingLogLoadedFor: string | null = null;

	constructor(private d: CompileStateDeps) {
		// .texpile/config.json: the project's own build settings, adopted on open and written back on
		// every change. Its compile command needs accepting once per project - see projectConfig.ts.
		$effect(() => {
			const root = d.guest() ? null : this.#root.current;
			// adopt() writes through workspaceStore, which the live command was ALREADY derived
			// from when the folder opened - so without re-resolving here the config landed in storage
			// and the editor went on using whatever it had worked out before reading the file.
			void projectConfig.adopt(root).then(() => this.resolveNow());
		});
		// The project scan names the main file after the folder-reset effect has run, so a Typst
		// project would otherwise sit on the inherited LaTeX command until something else re-resolved
		// it. Folders with a saved command of their own are unaffected (resolveCompileCommand prefers it).
		$effect(() => {
			const main = this.#main.current;
			if (main) this.command = resolveCompileCommand(main);
		});
		$effect(() => {
			const lane = effectiveCompileFormat(this.#main.current);
			if (d.guest() || lane === this.problemsLane) return;
			this.problemsLane = lane;
			d.typstPreview().clearLiveDiags();
			compileLog.set(null);
			this.share();
		});
		// guests: surface the host's shared compile diagnostics through the same Problems UI the host
		// has (the raw log never crosses the wire; see lib/collab/compileIntelBridge.ts)
		$effect(() => {
			if (!d.guest()) return;
			compileLog.set(guestCompileLog(d.session().compileIntel, Date.now()));
		});
		$effect(() => {
			if (d.session().active && !d.session().isGuest) {
				if (!this.outputsSharedForSession) {
					this.outputsSharedForSession = true;
					void d.compiler().shareExistingOutputs();
				}
			} else {
				this.outputsSharedForSession = false;
			}
		});
		// not a guest (solo or host): if the folder already has a .log from a previous compile, load its
		// problems on open so they show without a recompile. Re-runs as the command + main file resolve
		// (they fix the log path); a real compile that fills the log first wins.
		$effect(() => {
			const root = this.#root.current;
			void this.command; // dep: the log path depends on the resolved command
			void this.#main.current; // dep: and on the detected main file
			if (d.guest() || !root) {
				this.existingLogLoadedFor = null;
				return;
			}
			// mid folder-switch (root flipped, scan pending): the fallbacks below would resolve the
			// PREVIOUS folder's log and publish its problems here. The scan landing re-runs this.
			if (!this.#main.current && this.#texFiles.current.length === 0) return;
			if (this.existingLogLoadedFor === root) return;
			untrack(() => {
				if (get(compileLog)) {
					this.existingLogLoadedFor = root; // a compile already populated it
					return;
				}
				const logPath = d.compiler().expectedLogPath();
				if (!logPath) return; // command / main file not resolved yet; a later run retries
				this.existingLogLoadedFor = root;
				void (async () => {
					const s = await d.statFile(logPath);
					if (s.exists && s.size > 0 && get(workspaceRoot) === root && !get(compileLog)) {
						await d.compiler().publishLogDiagnostics(logPath, s.mtimeMs, true);
					}
				})();
			});
		});
	}

	/**
	 * The project speaks Typst, read off the compile target the way the compile modal reads it.
	 * This is what gates every format-specific menu: New-file offers .typ instead of .tex/.cls/.sty,
	 * the tree's New Include produces a .typ fragment with a #include, and so on. Markdown is
	 * offered either way - it is format-neutral.
	 */
	get typstProject(): boolean {
		return isTypstCommand(this.command);
	}

	/** last compile's problems for the file open in source mode */
	get sourceDiagnostics() {
		return this.d.guest()
			? guestDiagnosticsFor(this.d.session().compileIntel, this.d.doc.path)
			: hostDiagnosticsFor(this.#log.current, this.#root.current, this.d.doc.path);
	}

	/** re-derive the command from the current main file (folder switches, accepted config) */
	resolveNow(): void {
		this.command = resolveCompileCommand(get(mainFile));
	}

	share() {
		return shareHostCompileState(this.d.session(), this.d.guest());
	}
}
