// The source-mode table of contents: no ProseMirror plugin feeds the outline there, so parse
// headings from the raw .tex; \input fragments pre-scanned into projectIntel merge into one
// numbered project outline. Debounced (display-only) and reading state LIVE at fire time, so
// typing never pays the parse. Visual mode's TOC comes from PM headings instead.
import { get } from 'svelte/store';
import { trailingDebounce } from '$lib/trailingDebounce';
import { sourceTocStore } from '$lib/editor/visual/extensions/tableofcontents/tocStore';
import { parseOutlineRaw, assembleProjectOutline } from '$lib/editor/visual/extensions/tableofcontents/latexHeadings';
import { projectIntelStore } from '$lib/stores/projectIntel';
import { workspaceRoot } from '$lib/workspace/workspaceStore';
import { dirname } from '$lib/workspace/fileSystem';
import { fromStore } from 'svelte/store';
import type { WorkspaceDoc } from './workspaceDoc.svelte';

export function attachSourceToc(wsdoc: WorkspaceDoc): void {
	const { doc, modes } = wsdoc;
	const intel = fromStore(projectIntelStore);
	const deferred = trailingDebounce<void>(300, () => {
		if (doc.kind !== 'tex' || modes.mode !== 'source') return;
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
		void intel.current;
		if (doc.kind === 'tex' && modes.mode === 'source') deferred();
	});
	// a stale timer must not fire into the next workspace's store after unmount
	$effect(() => () => deferred.cancel());
}
