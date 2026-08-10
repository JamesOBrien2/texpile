<script lang="ts">
	// The right-hand preview pane (+ its drag splitter): the guest's pushed PDF, the Typst live
	// preview, the live draft renderer, or the compiled PDF. Renders two grid siblings, so it must
	// sit in a display:contents wrapper on the editor grid.
	import { ArrowRight, X } from '@lucide/svelte';
	import PDFViewer from './PDFViewer.svelte';
	import type DraftView from '$lib/draft/DraftView.svelte';
	import type TypstPreview from '$lib/typst/preview/TypstPreview.svelte';
	import { settings } from '$lib/settings';
	import { m } from '$lib/paraglide/messages';

	// DraftView drags in opentype.js; draft mode is opt-in, so it loads only when first shown
	let DraftViewComp = $state<typeof DraftView | null>(null);
	$effect(() => {
		if (!guest && $settings.draftMode && !DraftViewComp) {
			import('$lib/draft/DraftView.svelte').then(
				(mod) => (DraftViewComp = mod.default),
				(e) => console.error('Failed to load draft view chunk:', e)
			);
		}
	});

	// The Typst preview carries a ~1.2MB wasm renderer; a LaTeX project must never pay for it, so
	// the chunk is fetched only once a preview has actually been started.
	let TypstPreviewComp = $state<typeof TypstPreview | null>(null);
	$effect(() => {
		if (typstPreviewWanted && !TypstPreviewComp) {
			import('$lib/typst/preview/TypstPreview.svelte').then(
				(mod) => (TypstPreviewComp = mod.default),
				(e) => console.error('Failed to load Typst preview chunk:', e)
			);
		}
	});

	interface Props {
		width: number;
		dockShrunk: boolean;
		guest: boolean;
		guestPdf: ArrayBuffer | null;
		pdfFilename: string;
		draftRoot: string;
		draftMainRel: string;
		draftTrigger: number;
		/** `host:port` of a running Typst preview, or null while one is still starting */
		typstPreviewHost: string | null;
		/**
		 * A Typst preview is what this pane is FOR, even before it has an address.
		 *
		 * Kept separate from the host so the pane never briefly shows the compiled PDF while the
		 * preview is being prepared - that flash is jarring and looks like a bug.
		 */
		typstPreviewWanted: boolean;
		/** compile the previewed document to a PDF on disk (the preview itself never writes one) */
		onSaveTypstPdf: () => Promise<void>;
		/** one-shot jump of the preview to the editor caret; null hides the floating sync button */
		onSyncToCursor?: (() => void) | null;
		/** a splitter is being dragged; the frame holds its size rather than reflowing every frame */
		paneDragging: boolean;
		pdfPaneRef?: { scrollToPosition: (page: number, x: number, y: number, w?: number, h?: number) => void };
		draftRef?: DraftView | null;
		onStartResize: (e: MouseEvent) => void;
		onResizeByKey: (e: KeyboardEvent) => void;
		onClose: () => void;
		onPageClick: (page: number, x: number, y: number, selectText?: string) => void;
		onInverseSync: (file: string, line: number, selectText?: string) => void;
		onSettled: () => void;
		/** the finished compile's log path, for the Problems panel */
		onDiagnostics: (logPath: string) => void;
	}
	let {
		width,
		dockShrunk,
		guest,
		guestPdf,
		pdfFilename,
		draftRoot,
		draftMainRel,
		draftTrigger,
		typstPreviewHost,
		typstPreviewWanted,
		onSaveTypstPdf,
		onSyncToCursor = null,
		paneDragging,
		pdfPaneRef = $bindable(),
		draftRef = $bindable(),
		onStartResize,
		onResizeByKey,
		onClose,
		onPageClick,
		onInverseSync,
		onSettled,
		onDiagnostics
	}: Props = $props();
</script>

<!-- the WAI-ARIA window-splitter pattern (role=separator + tabindex); svelte's a11y rule doesn't special-case it -->
<!-- eslint-disable-next-line svelte/valid-compile -->
<div
	class="hover:bg-primary-500/40 active:bg-primary-500/60 relative z-20 -mx-[3px] w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors"
	style="grid-column: 2; grid-row: {dockShrunk ? '2 / -1' : '2'}"
	onmousedown={onStartResize}
	onkeydown={onResizeByKey}
	role="separator"
	aria-orientation="vertical"
	aria-label={m.wsview_resize_pdf_preview_aria()}
	tabindex="0"
></div>
<aside
	class="border-surface-200-800 relative flex shrink-0 flex-col border-l"
	style="width: {width}px; grid-column: 3; grid-row: {dockShrunk ? '2 / -1' : '2'}"
>
	{#if onSyncToCursor}
		<!-- forward sync floats on the splitter. Below the header rows (top-28),
		     so it doesn't sit on the intersection of the two header borders. A SIBLING of the
		     separator, not a child: nesting it made hovering the button light the whole drag
		     strip (and a role=separator should not contain a button anyway). preventDefault
		     keeps focus on the editor, whose CARET is what the jump reads. The reverse
		     direction needs no button: a click in the preview is the inverse jump. -->
		<button
			class="bg-surface-700-300 hover:bg-primary-500 absolute top-28 -left-[13px] z-30 cursor-pointer rounded-full p-1.5 text-white dark:text-black shadow-md"
			onmousedown={(e) => e.preventDefault()}
			onclick={onSyncToCursor}
			title={typstPreviewWanted && !guest ? m.wsview_sync_to_preview_title() : m.wsview_sync_to_pdf_title()}
			aria-label={typstPreviewWanted && !guest ? m.wsview_sync_to_preview_aria() : m.wsview_sync_to_pdf_aria()}
		>
			<ArrowRight class="size-3.5" />
		</button>
	{/if}
	{#if !(typstPreviewWanted && !guest)}
		<!-- h-9 matches the editor column's tab strip, so the two header borders draw one line -->
		<div
			class="bg-surface-100-900 text-surface-600-300 border-surface-200-800 flex h-9 shrink-0 items-center justify-between border-b px-3 text-xs"
		>
			<span class="font-medium">
				{#if !guest && $settings.draftMode}
					{m.wsview_live_preview_label()}
				{:else}
					{m.wsview_pdf_preview_label()}
				{/if}
			</span>
			<div class="flex items-center gap-1">
				<button
					class="hover:preset-tonal rounded p-1"
					onclick={onClose}
					title={m.wsview_close_preview()}
					aria-label={m.wsview_close_preview()}
				>
					<X class="size-4" />
				</button>
			</div>
		</div>
	{/if}
	<div class="min-h-0 flex-1">
		{#if guest}
			<!-- the host pushes its compiled PDF over the session; no local compile/synctex -->
			{#if guestPdf}
				<PDFViewer bind:this={pdfPaneRef} src={guestPdf} filename={m.wsview_pdf_preview_label()} {onPageClick} />
			{:else}
				<div class="text-surface-500 flex h-full items-center justify-center p-6 text-center text-sm">
					{m.session_pdf_waiting()}
				</div>
			{/if}
		{:else if typstPreviewWanted}
			<!-- tinymist's document stream, rendered in-pane. Takes precedence over the compiled PDF:
			     it is the same document and it is ahead of it, since it needs no save. Rendered on
			     `wanted` rather than on the host so the PDF never flashes up while it starts. -->
			{#if TypstPreviewComp}
				<TypstPreviewComp host={typstPreviewHost} {paneDragging} {onSaveTypstPdf} {onClose} />
			{/if}
		{:else if $settings.draftMode}
			{#if DraftViewComp}
				<DraftViewComp
					bind:this={draftRef}
					root={draftRoot}
					mainFile={draftMainRel}
					trigger={draftTrigger}
					{onInverseSync}
					{onSettled}
					{onDiagnostics}
				/>
			{/if}
		{:else}
			<PDFViewer bind:this={pdfPaneRef} filename={pdfFilename} {onPageClick} />
		{/if}
	</div>
</aside>
