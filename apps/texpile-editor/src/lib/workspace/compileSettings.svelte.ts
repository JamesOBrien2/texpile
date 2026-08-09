// The compile-command dialog's own state: the explicit format switch (latex | typst | auto),
// each format's own draft command, the per-folder output overrides, and persisting all of it.
// The switch is STORED state, never inferred from the command string; the two formats keep
// separate command/output slots, so flipping the switch never discards the other side's setup.
import { get } from 'svelte/store';
import {
	workspaceRoot,
	mainFile,
	savedCompileFormat,
	setCompileFormat,
	effectiveCompileFormat,
	setFormatCommand,
	savedFormatOutputs,
	setFormatOutputs,
	type CompileFormat
} from '$lib/workspace/workspaceStore';
import { resolveFormatCommand } from '$lib/workspace/compilePipeline.svelte';
import { isTypstCommand } from '$lib/workspace/typstCommand';
import { settings, updateSettings, DEFAULT_COMPILE_COMMAND } from '$lib/settings';

export class CompileSettings {
	modalOpen = $state(false);
	/** the format switch as shown in the dialog; persisted per folder on save. */
	format = $state<CompileFormat>('auto');
	draft = $state('');
	outputsDraft = $state<{ pdf: string; log: string }>({ pdf: '', log: '' });
	advancedOpen = $state(false);

	constructor(
		private getCommand: () => string,
		private setCommand: (c: string) => void,
		private runCompile: () => void
	) {}

	/** the concrete lane a chip means right now: auto reads the main file's extension. */
	private lane(format: CompileFormat = this.format): 'latex' | 'typst' {
		return format === 'auto' ? effectiveCompileFormat(get(workspaceRoot), get(mainFile)) : format;
	}

	/** what the command field shows for a chip: that lane's saved command, else its default. */
	commandFor(format: CompileFormat): string {
		return resolveFormatCommand(get(workspaceRoot), this.lane(format), get(settings).compileCommand, get(mainFile));
	}

	open() {
		const root = get(workspaceRoot);
		this.format = root ? savedCompileFormat(root) : 'auto';
		this.draft = this.commandFor(this.format);
		const ov = root ? savedFormatOutputs(root, this.lane()) : {};
		this.outputsDraft = { pdf: ov.pdf ?? '', log: ov.log ?? '' };
		this.advancedOpen = !!(ov.pdf || ov.log); // start expanded only if overrides exist
		this.modalOpen = true;
	}

	/** a format chip was clicked: swap the draft and the outputs to that lane's slots. */
	selectFormat(format: CompileFormat) {
		this.format = format;
		this.draft = this.commandFor(format);
		const root = get(workspaceRoot);
		const ov = root ? savedFormatOutputs(root, this.lane(format)) : {};
		this.outputsDraft = { pdf: ov.pdf ?? '', log: ov.log ?? '' };
	}

	save(thenRun: boolean) {
		const root = get(workspaceRoot);
		const lane = this.lane();
		const command = this.format === 'auto' ? this.commandFor('auto') : this.draft.trim();
		if (root) {
			setCompileFormat(root, this.format);
			// auto pins no command (the lane keeps deriving); explicit saves into that lane's slot
			if (this.format !== 'auto') setFormatCommand(root, lane, command || null);
			setFormatOutputs(root, lane, { pdf: this.outputsDraft.pdf.trim(), log: this.outputsDraft.log.trim() });
		}
		// the global default is the LATEX lane's starting point for brand-new folders; typst's
		// default is generated, so it needs no global slot
		if (this.format === 'latex' && command) updateSettings({ compileCommand: command });
		this.setCommand(command);
		this.modalOpen = false;
		if (thenRun && command) this.runCompile();
	}

	/**
	 * Apply a command and/or output overrides with no modal involved - the MCP path. The lane is
	 * taken from the command's binary here at the boundary (MCP hands a bare string), and setting
	 * a command pins that lane, mirroring what saving from the dialog does.
	 */
	applyCommand(command?: string, outputs?: { pdf?: string; log?: string }) {
		const root = get(workspaceRoot);
		if (command !== undefined) {
			const c = command.trim();
			const lane = c && isTypstCommand(c) ? 'typst' : 'latex';
			if (root) {
				if (c) {
					setCompileFormat(root, lane);
					setFormatCommand(root, lane, c);
				} else {
					setCompileFormat(root, 'auto');
				}
			}
			if (lane === 'latex' && c) updateSettings({ compileCommand: c });
			this.setCommand(c || this.commandFor('auto'));
		}
		if (outputs && root) {
			// merge, so setting only the PDF does not silently clear a log override the user set
			const lane = effectiveCompileFormat(root, get(mainFile));
			const cur = savedFormatOutputs(root, lane);
			setFormatOutputs(root, lane, { pdf: outputs.pdf ?? cur.pdf ?? '', log: outputs.log ?? cur.log ?? '' });
		}
		// keep an open dialog showing what was just applied under it
		if (this.modalOpen) this.open();
	}

	useDefault() {
		this.format = 'latex';
		this.draft = DEFAULT_COMPILE_COMMAND;
		this.save(true);
	}
}
