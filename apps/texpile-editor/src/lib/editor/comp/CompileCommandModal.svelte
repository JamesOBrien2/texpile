<script lang="ts">
	// The compile-command modal: the LaTeX/Typst format switch, live-mode switch, engine/latexmk
	// quick setup, the shell command, and the advanced per-folder output-path overrides. Persisting
	// is the caller's job.
	//
	// Format comes first and everything else reads off it: live mode and the engine chips are TeX
	// concepts with no Typst counterpart, so they are hidden rather than disabled when Typst is
	// selected. Every chip's state is derived from the command text, never stored alongside it.
	import { Switch } from '@skeletonlabs/skeleton-svelte';
	import { X, Play, ChevronDown } from '@lucide/svelte';
	import * as cc from '$lib/workspace/compileCommand';
	import { mainFile, type CompileFormat } from '$lib/workspace/workspaceStore';
	import { settings, updateSettings, DEFAULT_COMPILE_COMMAND } from '$lib/settings';
	import { collabHost } from '$lib/collab/hostStore.svelte';
	import { m } from '$lib/paraglide/messages';

	// live mode isn't supported while hosting a shared session (guests can't run the incremental engine)
	const sessionActive = $derived(collabHost.active);

	interface Props {
		open: boolean;
		command: string;
		/** the explicit format switch; CompileSettings owns swapping drafts when it changes */
		format: CompileFormat;
		onSelectFormat: (f: CompileFormat) => void;
		outputs: { pdf: string; log: string };
		advancedOpen: boolean;
		onSave: (thenRun: boolean) => void;
		onUseDefault: () => void;
		onRun: () => void;
	}
	let {
		open = $bindable(),
		command = $bindable(),
		format,
		onSelectFormat,
		outputs = $bindable(),
		advancedOpen = $bindable(),
		onSave,
		onUseDefault,
		onRun
	}: Props = $props();

	// quick-setup chip highlight state, reflected live from the draft (null engine = unrecognized)
	const engine = $derived(cc.detectEngine(command));
	const latexmk = $derived(cc.usesLatexmk(command));

	// The concrete lane the switch selects: the STORED format decides, with auto reading the main
	// file's extension. Nothing is inferred from the command string.
	const lane = $derived(format === 'auto' ? (/\.typ$/i.test($mainFile ?? '') ? 'typst' : 'latex') : format);
	const isTypst = $derived(lane === 'typst');

	// Live mode is in effect only when it would actually run: the pipeline ignores the setting for
	// Typst, so the shell command below is the real build and must stay visible and editable.
	const liveActive = $derived($settings.draftMode && !isTypst);
	// Typst's counterpart, gated the same way the pipeline gates it: while Preview is on, Compile
	// opens the preview and the shell command never runs, so showing it as editable would lie.
	const previewActive = $derived(isTypst && $settings.typstLiveMode !== false);

	// LaTeX and Typst are product names, so they are not translated; Auto is
	const FORMATS = [
		{ id: 'auto', label: () => m.wsview_format_auto() },
		{ id: 'latex', label: () => 'LaTeX' },
		{ id: 'typst', label: () => 'Typst' }
	] as const;
	const ENGINES = ['pdflatex', 'lualatex', 'xelatex'] as const;

	// the segmented-control classes Preferences' theme picker uses, so an exclusive choice looks the
	// same wherever it appears
	const SEGMENT = 'bg-surface-200-800 rounded-base flex shrink-0 gap-1 p-0.5';
	// `compact` keeps the engine row inside max-w-lg: three engine names are far longer than the
	// theme picker's System/Light/Dark, and at full size they push the latexmk checkbox off the row
	const seg = (active: boolean, compact = false) =>
		`rounded-base ${compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1 text-sm'} ${
			active ? 'bg-surface-50-950 font-medium shadow-sm' : 'text-surface-600-400 hover:text-surface-950-50'
		}`;

	function applyEngine(e: cc.Engine) {
		command = cc.buildCompileCommand(e, cc.usesLatexmk(command), command);
	}
	function applyLatexmk(on: boolean) {
		command = cc.buildCompileCommand(cc.detectEngine(command) ?? 'pdflatex', on, command);
	}
	function pathWarning(v: string, ext: '.pdf' | '.log'): string | null {
		const issue = cc.outputPathIssue(v, ext);
		if (issue === 'has-token') return m.wsview_warning_no_main_here({ token: '{main}' });
		if (issue === 'wrong-ext') return m.wsview_warning_should_end_in({ ext });
		return null;
	}
	const pdfPathWarning = $derived(pathWarning(outputs.pdf, '.pdf'));
	const logPathWarning = $derived(pathWarning(outputs.log, '.log'));
</script>

{#if open}
	<div
		class="fixed inset-0 z-1300 flex items-center justify-center app-scrim bg-black/40 p-4"
		role="presentation"
		onmousedown={(e) => e.target === e.currentTarget && (open = false)}
	>
		<div class="card bg-surface-50-950 border-surface-300-700 w-full max-w-lg border p-5 shadow-2xl">
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-base font-semibold">{m.wsview_compile_modal_title()}</h2>
				<button class="btn-icon btn-icon-sm hover:preset-tonal" onclick={() => (open = false)} aria-label={m.wsview_close_aria()}>
					<X class="size-4" />
				</button>
			</div>
			<!-- (main-file selection lives in the first-compile confirm modal and the file
			     tree's "Set as main file" - not here; this modal is only about the command) -->

			<!-- Which typesetter, first: it decides what every control under it means. Outside the
			     live-mode branch because live mode is itself LaTeX-only - the choice has to be
			     reachable to get out of it. -->
			<div class="border-surface-200-800 mb-3 flex items-center justify-between gap-4 border-b pb-3">
				<span class="text-sm font-medium">{m.wsview_format_label()}</span>
				<div class={SEGMENT}>
					{#each FORMATS as f (f.id)}
						<button type="button" class={seg(format === f.id)} onclick={() => onSelectFormat(f.id)}>
							{f.label()}
						</button>
					{/each}
				</div>
			</div>
			{#if format === 'auto'}
				<p class="text-surface-500 mb-2 text-xs">{m.wsview_auto_format_note()}</p>
			{/if}

			<!-- Live mode IS the incremental lualatex pipeline, so it means nothing for Typst and the
			     compile pipeline ignores the setting there. Hidden rather than disabled, for the same
			     reason the engine chips are: a control that cannot apply is not worth a row. The
			     setting is global and stays whatever it was, ready for the next LaTeX folder. -->
			{#if !isTypst}
				<div class="mb-1 flex items-center justify-between gap-4">
					<span class="text-sm">{m.wsview_live_mode_label()} <span class="text-surface-500">{m.wsview_experimental_label()}</span></span>
					<Switch checked={$settings.draftMode} disabled={sessionActive} onCheckedChange={(d) => updateSettings({ draftMode: d.checked })}>
						<Switch.Control><Switch.Thumb /></Switch.Control>
						<Switch.HiddenInput />
					</Switch>
				</div>

				{#if sessionActive}
					<p class="text-warning-700-300 mt-1 mb-1 text-xs">{m.wsview_live_mode_collab_note()}</p>
				{/if}
			{:else}
				<!-- Typst's counterpart to live mode, in the same slot. Called "Preview" because that is
				     what Typst's own tooling calls it: tinymist has a `preview` subcommand, and its editor
				     plugins ship the command as typst-preview.preview. (The other live thing Typst has is
				     `typst watch`, which is a rebuild-on-change - that is the separate Watch setting in
				     Preferences, and this is faster than it.) -->
				<div class="mb-1 flex items-center justify-between gap-4">
					<span class="text-sm">{m.wsview_preview_label()}</span>
					<Switch checked={$settings.typstLiveMode !== false} onCheckedChange={(d) => updateSettings({ typstLiveMode: d.checked })}>
						<Switch.Control><Switch.Thumb /></Switch.Control>
						<Switch.HiddenInput />
					</Switch>
				</div>
				<p class="text-surface-500 mt-1 mb-1 text-xs">{m.wsview_typst_preview_note()}</p>
			{/if}

			{#if liveActive}
				<p class="text-surface-500 mt-1 mb-1 text-xs">
					{m.wsview_livemode_desc_pre()} <strong>lualatex</strong>
					{m.wsview_livemode_desc_post()}
				</p>
				<div class="border-surface-300-700 text-surface-500 mt-3 rounded border border-dashed px-3 py-2 text-xs">
					{m.wsview_compile_disabled_live()}
					<code class="bg-surface-200-800 ml-1 rounded px-1 opacity-70">lualatex (built-in)</code>
				</div>
			{:else if previewActive}
				<!-- same dashed slot live mode uses: the command is kept for the folder, it just is not
				     what Compile runs while Preview is on -->
				<div class="border-surface-300-700 text-surface-500 mt-3 rounded border border-dashed px-3 py-2 text-xs">
					{m.wsview_compile_disabled_preview()}
					<code class="bg-surface-200-800 ml-1 rounded px-1 opacity-70">tinymist (built-in)</code>
				</div>
			{:else}
				<p class="text-surface-600-300 mt-2 mb-3 text-sm">
					{m.wsview_compile_desc_pre()} <code class="bg-surface-200-800 rounded px-1">{'{main}'}</code>
					{m.wsview_compile_desc_post()}
				</p>

				<!-- quick setup: chips reflect the command when recognizable, and regenerate it on click.
				     Engines and latexmk are TeX concepts; Typst has neither, so they go away entirely
				     rather than sitting there greyed out. Hidden under Auto too: they would edit a
				     command that is derived, not kept. -->
				{#if !isTypst && format !== 'auto'}
					<div class="mb-3 flex items-center justify-between gap-3">
						<span class="flex min-w-0 items-baseline gap-2 text-sm font-medium">
							{m.wsview_engine_label()}
							<!-- no segment is raised when the engine is unrecognized, so say why -->
							{#if engine === null && command.trim()}
								<span class="text-surface-400 truncate text-xs italic">{m.wsview_custom_label()}</span>
							{/if}
						</span>
						<div class="flex shrink-0 items-center gap-3">
							<div class={SEGMENT}>
								{#each ENGINES as eng (eng)}
									<button type="button" class={seg(engine === eng, true)} onclick={() => applyEngine(eng)}>
										{eng}
									</button>
								{/each}
							</div>
							<label class="text-surface-600-300 inline-flex items-center gap-1.5 text-xs">
								<input type="checkbox" class="checkbox" checked={latexmk} onchange={(e) => applyLatexmk(e.currentTarget.checked)} />
								{m.wsview_use_latexmk_label()}
							</label>
						</div>
					</div>
				{/if}

				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="input w-full font-mono text-sm {format === 'auto' ? 'opacity-60' : ''}"
					bind:value={command}
					placeholder={DEFAULT_COMPILE_COMMAND}
					spellcheck="false"
					autofocus
					disabled={format === 'auto'}
					title={format === 'auto' ? m.wsview_auto_format_note() : undefined}
					onkeydown={(e) => {
						if (e.key === 'Enter' && !(command.includes('{main}') && !$mainFile)) onSave(true);
						else if (e.key === 'Escape') open = false;
					}}
				/>
				<div class="mt-4 flex items-center justify-between gap-4">
					<span class="text-sm">{m.wsview_completion_marker_label()}</span>
					<Switch checked={$settings.compileSentinel} onCheckedChange={(d) => updateSettings({ compileSentinel: d.checked })}>
						<Switch.Control><Switch.Thumb /></Switch.Control>
						<Switch.HiddenInput />
					</Switch>
				</div>
				<p class="text-surface-500 mt-1 text-xs">
					{m.wsview_completion_marker_desc()}
				</p>
			{/if}

			{#if !liveActive && !previewActive}
				<button
					type="button"
					class="text-surface-500 hover:text-surface-950-50 mt-4 inline-flex items-center gap-1 text-xs"
					onclick={() => (advancedOpen = !advancedOpen)}
				>
					<ChevronDown class="size-3.5 transition-transform {advancedOpen ? '' : '-rotate-90'}" />
					{m.wsview_advanced_output_paths()}
				</button>
				{#if advancedOpen}
					<div class="mt-2 space-y-3">
						<p class="text-surface-500 text-xs">
							{m.wsview_advanced_desc_pre()}
							<code class="bg-surface-200-800 rounded px-1">-jobname</code>
							{m.wsview_advanced_desc_post()}
						</p>
						<div>
							<div class="mb-1 flex items-center justify-between gap-2">
								<span class="text-surface-600-300 text-xs font-medium">{m.wsview_pdf_file_label()}</span>
								{#if pdfPathWarning}<span class="text-warning-600-400 text-xs">{pdfPathWarning}</span>{/if}
							</div>
							<div class="flex gap-2">
								<input
									class="input flex-1 font-mono text-sm"
									bind:value={outputs.pdf}
									placeholder={m.wsview_auto_detected_placeholder()}
									spellcheck="false"
								/>
								<button
									type="button"
									class="btn btn-sm hover:preset-tonal shrink-0"
									onclick={() => (outputs.pdf = '')}
									disabled={!outputs.pdf}
									title={m.wsview_clear_autodetect_title()}
								>
									{m.wsview_auto_button()}
								</button>
							</div>
						</div>
						<div>
							<div class="mb-1 flex items-center justify-between gap-2">
								<span class="text-surface-600-300 text-xs font-medium">{m.wsview_log_file_label()}</span>
								{#if logPathWarning}<span class="text-warning-600-400 text-xs">{logPathWarning}</span>{/if}
							</div>
							<div class="flex gap-2">
								<input
									class="input flex-1 font-mono text-sm"
									bind:value={outputs.log}
									placeholder={m.wsview_auto_detected_placeholder()}
									spellcheck="false"
								/>
								<button
									type="button"
									class="btn btn-sm hover:preset-tonal shrink-0"
									onclick={() => (outputs.log = '')}
									disabled={!outputs.log}
									title={m.wsview_clear_autodetect_title()}
								>
									{m.wsview_auto_button()}
								</button>
							</div>
						</div>
					</div>
				{/if}
			{/if}

			<div class="mt-4 flex items-center justify-between gap-3">
				<span class="text-surface-500 text-xs">
					{#if !$mainFile}{m.wsview_pick_main_file_to_run()}{/if}
				</span>
				<div class="flex gap-2">
					<button class="btn btn-sm hover:preset-tonal" onclick={() => (open = false)}>{m.wsview_cancel_label()}</button>
					{#if liveActive || previewActive}
						<!-- one button either way: onRun goes through runCompile, which routes to the draft
						     engine or the Typst preview by the same conditions that hid the command above -->
						<button
							class="btn btn-sm preset-filled-primary-500 gap-1.5"
							onclick={() => {
								open = false;
								onRun();
							}}
							disabled={!$mainFile}
						>
							<Play class="size-4" />
							{m.wsview_run_preview()}
						</button>
					{:else}
						<button class="btn btn-sm hover:preset-tonal" onclick={() => onSave(false)}>{m.wsview_save_label()}</button>
						<button
							class="btn btn-sm preset-tonal-primary gap-1.5"
							onclick={onUseDefault}
							disabled={DEFAULT_COMPILE_COMMAND.includes('{main}') && !$mainFile}
							title={m.wsview_use_default_title()}
						>
							<Play class="size-4" />
							{m.wsview_use_default()}
						</button>
						<button
							class="btn btn-sm preset-filled-primary-500 gap-1.5"
							onclick={() => onSave(true)}
							disabled={command.includes('{main}') && !$mainFile}
						>
							<Play class="size-4" />
							{m.wsview_save_and_run()}
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
