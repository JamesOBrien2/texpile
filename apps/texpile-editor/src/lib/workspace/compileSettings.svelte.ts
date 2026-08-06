// The compile-command dialog's own state: the draft command, the per-folder output overrides,
// and persisting both. The command is saved per folder AND as the global default, so a new
// folder starts from whatever the user last settled on.
import { get } from 'svelte/store';
import { workspaceRoot, setFolderCompileCommand, savedCompileOutputs, setCompileOutputs } from '$lib/workspace/workspaceStore';
import { updateSettings, DEFAULT_COMPILE_COMMAND } from '$lib/settings';

export class CompileSettings {
	modalOpen = $state(false);
	draft = $state('');
	outputsDraft = $state<{ pdf: string; log: string }>({ pdf: '', log: '' });
	advancedOpen = $state(false);

	constructor(
		private getCommand: () => string,
		private setCommand: (c: string) => void,
		private runCompile: () => void
	) {}

	open() {
		this.draft = this.getCommand();
		const root = get(workspaceRoot);
		const ov = root ? savedCompileOutputs(root) : {};
		this.outputsDraft = { pdf: ov.pdf ?? '', log: ov.log ?? '' };
		this.advancedOpen = !!(ov.pdf || ov.log); // start expanded only if overrides exist
		this.modalOpen = true;
	}

	save(thenRun: boolean) {
		const command = this.draft.trim();
		this.setCommand(command);
		const root = get(workspaceRoot);
		if (root) {
			setFolderCompileCommand(root, command || null);
			setCompileOutputs(root, { pdf: this.outputsDraft.pdf.trim(), log: this.outputsDraft.log.trim() });
		}
		updateSettings({ compileCommand: command }); // also the starting default for folders without their own
		this.modalOpen = false;
		if (thenRun && command) this.runCompile();
	}

	/**
	 * Apply a command and/or output overrides with no modal involved - the MCP path.
	 *
	 * Shares save()'s persistence deliberately rather than writing the same three stores again:
	 * a command set from outside has to land in the folder map, the global default AND the live
	 * compile pipeline, and a copy of that list would drift the first time one of them moved.
	 * Each argument is optional so a caller can change the outputs without touching the command.
	 */
	applyCommand(command?: string, outputs?: { pdf?: string; log?: string }) {
		const root = get(workspaceRoot);
		if (command !== undefined) {
			const c = command.trim();
			this.setCommand(c);
			if (root) setFolderCompileCommand(root, c || null);
			updateSettings({ compileCommand: c });
		}
		if (outputs && root) {
			// merge, so setting only the PDF does not silently clear a log override the user set
			const cur = savedCompileOutputs(root);
			setCompileOutputs(root, { pdf: outputs.pdf ?? cur.pdf ?? '', log: outputs.log ?? cur.log ?? '' });
		}
		// keep an open dialog showing what was just applied under it
		if (this.modalOpen) this.open();
	}

	useDefault() {
		this.draft = DEFAULT_COMPILE_COMMAND;
		this.save(true);
	}
}
