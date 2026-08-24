// The parser worker's handle, kept apart from its client so launch can warm it without pulling
// the schemas (and prosemirror-model) into the boot chunk. Its own module is ~400KB, and loading
// that only once the first document asks put the whole of it in front of the first render.
let worker: Worker | null = null;

export function latexParserWorker(): Worker {
	return (worker ??= new Worker(new URL('./latexParser.worker.ts', import.meta.url), { type: 'module' }));
}

/** drop the worker (crash, runaway parse); the next call boots a fresh one */
export function resetLatexParserWorker(): void {
	worker?.terminate();
	worker = null;
}
