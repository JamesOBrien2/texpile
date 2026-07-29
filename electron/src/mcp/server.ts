// The MCP server: a loopback HTTP endpoint hosted inside the running Electron main process.
//
// It has to live here rather than being spawned by the client, because the whole point is the LIVE
// editor - which tabs are open, where the caret is, what is unsaved. A freshly spawned process
// would know none of that. Clients that only speak stdio reach this through the `texpile-mcp`
// bridge, which reads the endpoint file below and pipes stdio to this port.
//
// Nothing here mutates a document. The connected agent already has its own file tools and is better
// at using them; what it cannot get any other way is the editor's state, and what it cannot do is
// steer the window. That is the whole scope, and it is what keeps this safe: no tool accepts an
// arbitrary path, so there is no traversal surface to defend.
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { snapshot, type WorkspaceSnapshot } from './state';
import { request, sendCommand } from './bridge';

export interface McpHost {
	/** where the endpoint file goes (app.getPath('userData')) */
	userDataDir: string;
	/** the configured port. Fixed, not ephemeral: see PORT_DEFAULT. */
	port: number;
	/** every open window, in creation order */
	windows(): { webContentsId: number; focused: boolean }[];
	/** the workspace root claimed by a window, or null */
	rootFor(wcId: number): string | null;
	/** raw BrowserWindow list for the state snapshot */
	windowObjects(): Parameters<typeof snapshot>[0];
	/**
	 * The window to act on for a given workspace root, or the focused one when root is omitted.
	 * Resolving by root matters more than it looks: focus follows the user's clicks, so a tool that
	 * always targeted the focused window would steer whichever project they happened to look at.
	 */
	windowFor(root?: string): { win: Parameters<typeof snapshot>[0][number]; root: string | null } | null;
	/** told when a client connects or the last one goes away, for the topbar indicator */
	onConnectionChange?(client: string | null): void;
}

const ENDPOINT_FILE = 'mcp-endpoint.json';

/**
 * A FIXED port, not an ephemeral one, so a client can be configured once and keep working
 * tomorrow. An ephemeral port would change every launch, which is precisely the problem the stdio
 * bridge exists to paper over - with a stable address most clients dial in directly and need no
 * bridge at all.
 *
 * A dev-channel build gets its own port so a test exe can run beside an installed Texpile, the same
 * way it already gets its own settings dir and instance lock.
 */
export const PORT_DEFAULT = 7317;
export const PORT_DEFAULT_DEV = 7318;

let http: Server | null = null;
let host: McpHost | null = null;
let lastError: string | null = null;

export interface McpStatus {
	running: boolean;
	port: number | null;
	/** set when the last start attempt failed, e.g. the port was taken */
	error: string | null;
}

export function status(): McpStatus {
	const addr = http?.address();
	return {
		running: !!http,
		port: addr && typeof addr === 'object' ? addr.port : null,
		error: lastError
	};
}

/**
 * With no token, THIS is the access control, so it carries real weight.
 *
 * A page on any origin can POST to localhost, so a rebound DNS name pointing at 127.0.0.1 is the
 * realistic attack. Any browser context sends an Origin it does not control - a page its own domain,
 * an extension chrome-extension://... - and none of those match, so the request never reaches the
 * protocol layer. Real MCP clients are not browsers and send no Origin at all.
 *
 * Two further things stop a browser regardless: we send no CORS headers, so a page could not read a
 * reply even if one came back, and MCP requires Content-Type: application/json, which a plain form
 * post cannot set.
 */
function originOk(req: IncomingMessage): boolean {
	const origin = req.headers.origin;
	if (!origin) return true;
	return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin);
}

function buildServer(): McpServer {
	const server = new McpServer({ name: 'texpile', version: '1' }, { capabilities: { tools: {} } });

	server.registerTool(
		'get_editor_state',
		{
			title: 'Get Texpile editor state',
			description:
				'What Texpile is showing right now: every open workspace window, its tabs and which have ' +
				'unsaved changes, the active file, view mode, caret and selection. Use this to work on what ' +
				'the user is actually looking at. Prefer the workspace whose root matches your working ' +
				'directory over the focused one, since focus changes when the user clicks another window.',
			inputSchema: {}
		},
		async () => {
			const h = host;
			if (!h) return { content: [{ type: 'text' as const, text: '{"error":"server not running"}' }] };
			const workspaces: WorkspaceSnapshot[] = snapshot(h.windowObjects(), (id) => h.rootFor(id));
			const focused = workspaces.find((w) => w.focused)?.root ?? null;
			return {
				content: [{ type: 'text' as const, text: JSON.stringify({ focused, workspaces }, null, 2) }]
			};
		}
	);

	const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });
	const fail = (message: string) => ({ isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }] });

	/** every tool below needs a window; root picks one when several are open */
	const target = (root?: string) => {
		if (!host) return null;
		return host.windowFor(root);
	};

	server.registerTool(
		'get_unsaved',
		{
			title: 'Get unsaved editor content',
			description:
				'The in-editor text of the active file when it has unsaved changes. Call this whenever ' +
				'get_editor_state reports a dirty tab: the copy on disk is stale, so reading the file would ' +
				'give you older content than the user is looking at. Returns dirty:false and no content when ' +
				'nothing is unsaved, in which case read the file from disk as normal.',
			inputSchema: { root: z.string().optional().describe('workspace root; defaults to the focused window') }
		},
		async ({ root }) => {
			const t = target(root);
			if (!t) return fail('no matching Texpile window');
			// pulled rather than pushed: a dirty 2 MB paper is not worth sending on every keystroke
			const data = await request(t.win, 'unsaved');
			if (data === null) return fail('the editor did not respond in time (it may be busy loading a large document)');
			return ok(data);
		}
	);

	server.registerTool(
		'get_diagnostics',
		{
			title: 'Get compile errors and warnings',
			description:
				'Errors and warnings parsed from the last compile, with file and line. Reflects the last ' +
				'compile the user ran - it does not compile anything, so if they have edited since, this is ' +
				'stale. Empty before the first compile of the session.',
			inputSchema: { root: z.string().optional().describe('workspace root; defaults to the focused window') }
		},
		async ({ root }) => {
			const t = target(root);
			if (!t) return fail('no matching Texpile window');
			const data = await request(t.win, 'diagnostics');
			if (data === null) return fail('the editor did not respond in time');
			return ok(data);
		}
	);

	server.registerTool(
		'open_file',
		{
			title: 'Open a file in Texpile',
			description:
				'Bring a file in the workspace forward in the editor, optionally at a line. NOTE: passing a ' +
				'line switches the window to Source mode, because a line number only means anything there - ' +
				'omit it to open the file without changing how the user is viewing their document. Paths are ' +
				'workspace-relative.',
			inputSchema: {
				path: z.string().describe('workspace-relative path, e.g. sections/method.tex'),
				line: z.number().int().positive().optional().describe('1-based line; switches to Source mode'),
				root: z.string().optional().describe('workspace root; defaults to the focused window')
			}
		},
		async ({ path: p, line, root }) => {
			const t = target(root);
			if (!t) return fail('no matching Texpile window');
			// The renderer resolves this against the workspace tree, not the filesystem. That is the
			// whole containment story for this server: it is the only tool taking a path, and the path
			// never reaches fs-service.
			sendCommand(t.win, { kind: 'open_file', path: p, line });
			return ok({ opened: p, line: line ?? null, switchedToSource: line !== undefined });
		}
	);

	server.registerTool(
		'show_diff',
		{
			title: 'Show a file diff in Texpile',
			description:
				"Switch the window to Diff view, showing the file's working changes against git HEAD. Useful " +
				'after you have edited files, so the user can see what changed. This changes what is on ' +
				'screen, so use it when you have something worth showing, not speculatively.',
			inputSchema: {
				path: z.string().optional().describe('workspace-relative path; defaults to the active file'),
				root: z.string().optional().describe('workspace root; defaults to the focused window')
			}
		},
		async ({ path: p, root }) => {
			const t = target(root);
			if (!t) return fail('no matching Texpile window');
			// a request, not a command: entering diff is refused outright when the folder is not a git
			// repo, and reporting success we never confirmed is how a caller gets misled
			const r = (await request(t.win, 'show_diff', { path: p })) as { ok?: boolean; reason?: string } | null;
			if (r === null) return fail('the editor did not respond in time');
			if (!r.ok) return fail(r.reason ?? 'the editor refused to show a diff');
			return ok(r);
		}
	);

	server.registerTool(
		'set_view_mode',
		{
			title: 'Set the Texpile view mode',
			description:
				'Switch between Visual (WYSIWYG), Source (LaTeX) and Diff. Changes what the user sees, so ' +
				'prefer leaving it alone unless the mode is the point - for example switching to Source ' +
				'before pointing at a specific line.',
			inputSchema: {
				mode: z.enum(['visual', 'source', 'diff']),
				root: z.string().optional().describe('workspace root; defaults to the focused window')
			}
		},
		async ({ mode, root }) => {
			const t = target(root);
			if (!t) return fail('no matching Texpile window');
			const r = (await request(t.win, 'view_mode', { mode })) as { ok?: boolean; reason?: string; viewMode?: string } | null;
			if (r === null) return fail('the editor did not respond in time');
			if (!r.ok) return fail(`${r.reason ?? 'refused'} (still in ${r.viewMode ?? 'unknown'} mode)`);
			return ok(r);
		}
	);

	server.registerTool(
		'synctex_to_line',
		{
			title: 'Show a source line in the PDF',
			description:
				'Forward SyncTeX: scroll the PDF pane to where a line of the open file renders, and open the ' +
				'pane if it is closed. This is the good way to point at something, because the user keeps ' +
				'reading their document while seeing the typeset result. Needs a compiled PDF with SyncTeX ' +
				'data; if the file has changed since the last compile the position will be approximate.',
			inputSchema: {
				line: z.number().int().positive().describe('1-based line in the currently open file'),
				root: z.string().optional().describe('workspace root; defaults to the focused window')
			}
		},
		async ({ line, root }) => {
			const t = target(root);
			if (!t) return fail('no matching Texpile window');
			const r = (await request(t.win, 'synctex', { line })) as { ok?: boolean; reason?: string } | null;
			if (r === null) return fail('the editor did not respond in time');
			if (!r.ok) return fail(r.reason ?? 'could not sync to that line');
			return ok(r);
		}
	);

	server.registerTool(
		'compile',
		{
			title: 'Compile the document',
			description:
				"Run the project's configured compile, exactly as the toolbar button does. Returns as soon as " +
				'it starts, since a compile takes seconds to minutes. The reply says which mode it ran in ' +
				'and what to do next: in terminal mode poll get_diagnostics once it finishes, while in live ' +
				'mode the preview is already recompiling incrementally and this only nudges it. Runs in its ' +
				'own terminal either way and does not take over whatever shell the user is in.',
			// No engine and no flags, deliberately. The compile runs with -no-shell-escape, which is the
			// only thing standing between "compile a .tex file" and arbitrary code execution; a flags
			// passthrough would hand that to anything able to write a .tex file, including the caller.
			inputSchema: { root: z.string().optional().describe('workspace root; defaults to the focused window') }
		},
		async ({ root }) => {
			const t = target(root);
			if (!t) return fail('no matching Texpile window');
			const r = (await request(t.win, 'compile')) as { ok?: boolean; mode?: string; note?: string } | null;
			if (r === null) return fail('the editor did not respond in time');
			// pass the renderer's own mode and guidance through rather than restating it here, so the
			// two cannot drift apart
			return ok(r);
		}
	);

	return server;
}

/**
 * Stateless mode wants a FRESH server and transport per request. Sharing one across requests
 * survives `initialize` and then fails every later call with a 500, because without a session id
 * the transport has no way to associate a second request with the first one's state. Our tools are
 * all pure request/response, so there is nothing worth keeping between calls anyway, and building a
 * server per call is cheap next to the round trip.
 */
async function handleStateless(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const server = buildServer();
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
	// tear both down when the response ends, however it ends, or each call leaks a transport
	res.on('close', () => {
		void transport.close().catch(() => {});
		void server.close().catch(() => {});
	});
	try {
		await server.connect(transport);
		await transport.handleRequest(req, res);
	} catch (e) {
		console.error('mcp: request failed', e);
		if (!res.headersSent) res.writeHead(500).end('internal error');
	}
}

export async function start(h: McpHost): Promise<McpStatus> {
	if (http) return status();
	host = h;
	lastError = null;

	http = createServer((req: IncomingMessage, res: ServerResponse) => {
		if (!originOk(req)) {
			res.writeHead(403).end('forbidden origin');
			return;
		}
		h.onConnectionChange?.(String(req.headers['user-agent'] || 'MCP client'));
		void handleStateless(req, res);
	});

	try {
		await new Promise<void>((resolve, reject) => {
			http!.once('error', reject);
			// 127.0.0.1 rather than 0.0.0.0, so this is never reachable off-box
			http!.listen(h.port, '127.0.0.1', resolve);
		});
	} catch (e) {
		// Fail loudly instead of falling back to another port. A silent fallback would leave the
		// user's pasted config pointing at a port we are not on - or worse, at whatever else took
		// it - and that is not something they could reasonably debug.
		const code = (e as NodeJS.ErrnoException).code;
		lastError = code === 'EADDRINUSE' ? `Port ${h.port} is already in use` : String((e as Error).message || e);
		http?.close();
		http = null;
		return status();
	}

	writeEndpointFile(h.userDataDir);
	return status();
}

export async function stop(): Promise<void> {
	const dir = host?.userDataDir;
	const server = http;
	http = null;
	if (server) await new Promise<void>((r) => server.close(() => r()));
	if (dir) removeEndpointFile(dir);
	host?.onConnectionChange?.(null);
	host = null;
}

/** How a stdio bridge finds the current port. */
function writeEndpointFile(dir: string): void {
	const { port } = status();
	try {
		writeFileSync(join(dir, ENDPOINT_FILE), JSON.stringify({ port, pid: process.pid }, null, 2), { mode: 0o600 });
	} catch (e) {
		console.error('mcp: could not write endpoint file', e);
	}
}

function removeEndpointFile(dir: string): void {
	try {
		rmSync(join(dir, ENDPOINT_FILE), { force: true });
	} catch {
		// a leftover file is harmless: nothing is listening on the port it names
	}
}
