// Renderer end of the MCP tools: answering requests main cannot serve from its state cache, and
// carrying out the steer commands. Nothing here writes a document - the connected agent has its own
// file tools for that, and keeping writes out is what makes this surface safe.
import { get } from 'svelte/store';
import { browser } from '$lib/runtime';
import { workspaceRoot, isDirty } from './workspaceStore';
import { isGitRepo, refreshGitStatus } from './gitStore';
import { compileLog } from '$lib/stores/compileLogStore';
import { settings } from '$lib/settings';
import { joinPath, relativeTo, samePath } from './fileSystem';

export interface McpCommandDeps {
	/** the open file's absolute path */
	getLoadedPath(): string | null;
	/** the live buffer for whichever kind is open */
	getBuffer(): string;
	/** open a file (already resolved to absolute) without changing view mode */
	openFile(abs: string): void;
	/** open at a 1-based line; switches to Source, where a line number is meaningful */
	openFileAtLine(abs: string, line: number): void;
	showDiff(): void;
	setViewMode(mode: 'visual' | 'source' | 'diff'): void;
	/** the mode actually in effect, so a refused switch can be reported instead of assumed */
	getViewMode(): 'visual' | 'source' | 'diff';
	/** forward SyncTeX: move the PDF pane to where a source line renders */
	syncToLine(line: number): void;
	/** run the project's configured compile, exactly as the toolbar button does */
	runCompile(): void;
}

interface NativeMcp {
	onMcpRequest?: (cb: (req: { id: number; kind: string; args?: Record<string, unknown> }) => void) => () => void;
	mcpRespond?: (id: number, data: unknown) => void;
	onMcpCommand?: (cb: (cmd: Record<string, unknown>) => void) => () => void;
}
function native(): NativeMcp | undefined {
	if (!browser) return undefined;
	return (window as unknown as { texpileNative?: NativeMcp }).texpileNative;
}

/** cap: a whole compile's warnings can run to hundreds, and an agent needs the first ones, not all */
const MAX_DIAGNOSTICS = 50;

function unsavedPayload(deps: McpCommandDeps) {
	const path = deps.getLoadedPath();
	const root = get(workspaceRoot);
	// Only the active file has a buffer, so it is the only one that can be dirty. Clean means disk
	// is authoritative, and saying so explicitly is more useful than an empty string the agent has
	// to guess about.
	if (!path || !get(isDirty)) return { dirty: false, content: null, path: path && root ? relativeTo(root, path) : path };
	return { dirty: true, path: root ? relativeTo(root, path) : path, content: deps.getBuffer() };
}

function diagnosticsPayload() {
	const log = get(compileLog);
	if (!log) return { compiled: false, errors: [], warnings: [] };
	const trim = (list: typeof log.errors) =>
		list.slice(0, MAX_DIAGNOSTICS).map((e) => ({ message: e.message, file: e.file ?? null, line: e.line ?? null }));
	return {
		compiled: true,
		status: log.status,
		// so a truncated list does not read as "that was all of them"
		errorCount: log.errors.length,
		warningCount: log.warnings.length,
		errors: trim(log.errors),
		warnings: trim(log.warnings)
	};
}

/** resolve a workspace-relative path against the OPEN TREE, never the filesystem. This is the
 * containment boundary for the whole server: the only path a client can supply arrives here, and it
 * can only ever name a file already known to this workspace. */
function resolveInWorkspace(rel: string): string | null {
	const root = get(workspaceRoot);
	if (!root || !rel) return null;
	if (rel.includes('\0')) return null;
	const abs = joinPath(root, rel.replace(/\\/g, '/'));
	// reject anything that climbed out of the root via .. before it reaches an open
	if (!samePath(abs, root) && !abs.toLowerCase().startsWith(root.toLowerCase())) return null;
	// a file that does not exist is left to the opener's normal "cannot load" path rather than
	// checked here: this function's job is containment, not existence
	return abs;
}

/**
 * Switching mode can be REFUSED, so this reports what actually happened instead of assuming.
 * Diff is the case that bites: viewModeSwitch.set() returns silently when the folder is not a git
 * repo or nothing is loaded, so a tool that reported success was simply lying - which is exactly how
 * a caller ended up believing diff worked and then that it silently no-oped.
 *
 * isGitRepo is also probed at launch, so a repo created afterwards (git init in a terminal, or a
 * clone landing) leaves it stale and diff refuses for a reason that is no longer true. Re-checking
 * before giving up costs one git call on a path that is already a user-visible action.
 */
async function viewModePayload(deps: McpCommandDeps, mode: unknown) {
	if (mode !== 'visual' && mode !== 'source' && mode !== 'diff') return { ok: false, reason: 'unknown mode', viewMode: deps.getViewMode() };
	if (mode === 'diff') {
		if (!deps.getLoadedPath()) return { ok: false, reason: 'no file is open', viewMode: deps.getViewMode() };
		const root = get(workspaceRoot);
		if (root && !get(isGitRepo)) await refreshGitStatus(root);
		if (!get(isGitRepo))
			return {
				ok: false,
				reason: 'this workspace is not a git repository, so there is nothing to diff against',
				viewMode: deps.getViewMode()
			};
	}
	deps.setViewMode(mode);
	const now = deps.getViewMode();
	return now === mode ? { ok: true, viewMode: now } : { ok: false, reason: 'the editor refused the switch', viewMode: now };
}

function syncTexPayload(deps: McpCommandDeps, line: unknown) {
	const n = Number(line);
	if (!Number.isInteger(n) || n < 1) return { ok: false, reason: 'line must be a positive integer' };
	if (!deps.getLoadedPath()) return { ok: false, reason: 'no file is open' };
	// Needs a compiled PDF with a .synctex to resolve against, and the pane opens itself. Failure is
	// reported by SyncTexNav through its own toast rather than surfacing here, so this only confirms
	// the request was dispatched.
	deps.syncToLine(n);
	return { ok: true, line: n };
}

/** wire the MCP request/command channels; returns the detach function */
export function attachMcpCommands(deps: McpCommandDeps): () => void {
	const api = native();
	const offRequest = api?.onMcpRequest?.((req) => {
		const a = req.args ?? {};
		const reply = (data: unknown) => api.mcpRespond?.(req.id, data);
		if (req.kind === 'unsaved') return reply(unsavedPayload(deps));
		if (req.kind === 'diagnostics') return reply(diagnosticsPayload());
		if (req.kind === 'synctex') return reply(syncTexPayload(deps, a.line));
		if (req.kind === 'compile') {
			// Live mode and terminal mode are different enough that the caller has to be told which one
			// it got. In live mode runCompile() drives the incremental draft engine, the preview is
			// already refreshing on its own, and diagnostics come from that engine rather than a .log a
			// shell wrote - so "I compiled, now poll get_diagnostics" is the wrong mental model there.
			const live = get(settings).draftMode === true;
			deps.runCompile();
			// Dispatch only either way. A terminal compile is seconds to minutes, so waiting here would
			// just time out.
			return reply({
				ok: true,
				started: true,
				mode: live ? 'live' : 'terminal',
				note: live
					? 'Live mode: the preview recompiles incrementally on its own, so this only nudges it. Diagnostics come from the draft engine.'
					: 'Terminal mode: runs the configured compile command in the Compile shell. Poll get_diagnostics once it finishes.'
			});
		}
		if (req.kind === 'view_mode') return void viewModePayload(deps, a.mode).then(reply);
		if (req.kind === 'show_diff') {
			const rel = typeof a.path === 'string' ? a.path : null;
			if (rel) {
				const abs = resolveInWorkspace(rel);
				if (!abs) return reply({ ok: false, reason: 'path is outside this workspace' });
				deps.openFile(abs);
			}
			return void viewModePayload(deps, 'diff').then(reply);
		}
		reply({ error: 'unknown request' });
	});

	const offCommand = api?.onMcpCommand?.((cmd) => {
		const kind = String(cmd.kind ?? '');
		// set_view_mode / show_diff / synctex / compile arrive as REQUESTS, not commands: each can be
		// refused, and the caller needs to hear that rather than assume it worked.
		if (kind === 'open_file') {
			const rel = typeof cmd.path === 'string' ? cmd.path : '';
			const abs = resolveInWorkspace(rel);
			if (!abs) return; // outside the workspace: ignore rather than reach for it
			const line = typeof cmd.line === 'number' && cmd.line > 0 ? Math.floor(cmd.line) : null;
			if (line) deps.openFileAtLine(abs, line);
			else deps.openFile(abs);
		}
	});

	return () => {
		offRequest?.();
		offCommand?.();
	};
}
