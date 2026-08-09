// reactive state for the open workspace; the file path is the identity, no doc ids
import { writable } from 'svelte/store';
import { browser } from '$lib/runtime';
import { isTypstCommand } from './typstCommand';
import type { TexFile, TreeEntry } from './fileSystem';

const RECENT_KEY = 'texpile:recentFolders';
// ONE entry per workspace folder, everything the app remembers about it grouped together —
// see WorkspaceEntry. (recentFolders stays its own ordered list: it is an MRU, not per-folder config.)
const WORKSPACES_KEY = 'texpile:workspaces';
// the four parallel per-folder maps this store grew historically; migrated into WORKSPACES_KEY
// on first load and then removed
const LEGACY_KEYS = {
	main: 'texpile:mainFiles',
	lastFile: 'texpile:lastFiles',
	cmd: 'texpile:compileCommands',
	outputs: 'texpile:compileOutputs'
} as const;

export const workspaceRoot = writable<string | null>(null);

export const texFiles = writable<TexFile[]>([]);

export const fileTree = writable<TreeEntry[]>([]);

export const activeFilePath = writable<string | null>(null);

/** the main entry .tex, anchors cross-file macro resolution. auto-detected, user-overridable, persisted per folder. */
export const mainFile = writable<string | null>(null);

export const isDirty = writable<boolean>(false);

// Declared BEFORE the store below, and it has to stay there. loadRecent() is hoisted so calling it
// at init works, but the const is not: reading it from inside that call hits the temporal dead zone,
// throws, and the catch quietly returns [] - so the list loaded as empty every launch and the first
// folder opened overwrote the whole history with itself.
const MAX_RECENT = 8;

/** most-recent first, persisted to localStorage. */
export const recentFolders = writable<string[]>(loadRecent());

// cap on READ as well as write: the stored value is just localStorage, so a hand-edited or
// older-format entry would otherwise render an unbounded list until the next folder open trims it
function loadRecent(): string[] {
	if (!browser) return [];
	try {
		const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
		return Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENT) : [];
	} catch {
		return [];
	}
}

export function addRecentFolder(path: string): void {
	recentFolders.update((list) => {
		const next = [path, ...list.filter((p) => p !== path)].slice(0, MAX_RECENT);
		if (browser) localStorage.setItem(RECENT_KEY, JSON.stringify(next));
		return next;
	});
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
/** path of abs relative to root (forward slashes), or abs unchanged if not under root. */
function relInRoot(root: string, abs: string): string {
	const r = norm(root) + '/';
	const a = norm(abs);
	// case-insensitive prefix (Windows varies the drive-letter case, see mainKeyFor); a case-sensitive
	// check would store the whole absolute path as the "rel" and it would never round-trip
	return a.toLowerCase().startsWith(r.toLowerCase()) ? a.slice(r.length) : a;
}
/** joins a folder + a stored relative path back into an absolute path (native-ish separators). */
function absInRoot(root: string, rel: string): string {
	const sep = root.includes('\\') ? '\\' : '/';
	// join the WHOLE path in the root's own separator. norm() forward-slashes the root, so
	// appending a backslash-joined tail to it produced "C:/dir\sub\file.tex" -- fine for the fs,
	// which accepts either, but it matches nothing when compared against the tree's own
	// all-backslash paths, so a restored file never highlighted as the open one.
	return norm(root).split('/').join(sep) + sep + rel.split('/').join(sep);
}

/** manual overrides for where the compile writes its PDF/log, when auto-detection guesses wrong. */
export interface CompileOutputs {
	/** path to the compiled PDF (relative to root, or absolute); blank = auto-detect from command. */
	pdf?: string;
	/** path to the .log (relative to root, or absolute); blank = auto-detect (next to the PDF). */
	log?: string;
}

/** which typesetter Compile drives. 'auto' (the default for every new workspace) follows the
 *  main file's extension. Stored EXPLICITLY - never inferred from the command string. */
export type CompileFormat = 'latex' | 'typst' | 'auto';

/** one format's own compile config; latex and typst each keep theirs, so switching the format
 *  switch never throws the other side's command away. */
interface FormatConfig {
	command?: string;
	outputs?: CompileOutputs;
}

/** everything the app remembers about one workspace folder, grouped under its root path. */
interface WorkspaceEntry {
	/** root-relative main file (compile target + macro-scan anchor) */
	main?: string;
	/** root-relative last-open file, restored on reopening the folder */
	lastFile?: string;
	/** the format switch; absent = 'auto' */
	compile?: 'latex' | 'typst';
	latex?: FormatConfig;
	typst?: FormatConfig;
	/** pre-format-split fields, migrated on load and never written again */
	compileCommand?: string;
	outputs?: CompileOutputs;
}

function readJsonObject<T extends object>(key: string): T | null {
	try {
		const v = JSON.parse(localStorage.getItem(key) || 'null');
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null;
	} catch {
		return null;
	}
}

/**
 * A pre-format-split entry stored one flat compileCommand/outputs; sort those into the format
 * slots. This is the ONLY place a format is ever inferred from a command string - one time, at
 * migration - and an inferred pin is kept so migrated folders behave exactly as before.
 */
function normalizeEntry(e: WorkspaceEntry): boolean {
	if (e.compileCommand === undefined && e.outputs === undefined) return false;
	const fmt: 'latex' | 'typst' = e.compileCommand
		? isTypstCommand(e.compileCommand)
			? 'typst'
			: 'latex'
		: e.main && /\.typ$/i.test(e.main)
			? 'typst'
			: 'latex';
	const cfg = e[fmt] ?? {};
	if (e.compileCommand && !cfg.command) cfg.command = e.compileCommand;
	if (e.outputs && !cfg.outputs) cfg.outputs = e.outputs;
	if (cfg.command || cfg.outputs) e[fmt] = cfg;
	if (e.compileCommand) e.compile = fmt;
	delete e.compileCommand;
	delete e.outputs;
	return true;
}

/**
 * The per-workspace map, migrating the four parallel legacy maps into it on first load. The
 * migration runs at most once: as soon as WORKSPACES_KEY exists it is the only source of truth,
 * and the legacy keys are deleted so stale copies can't shadow later edits.
 */
function loadWorkspaces(): Record<string, WorkspaceEntry> {
	if (!browser) return {};
	const current = readJsonObject<Record<string, WorkspaceEntry>>(WORKSPACES_KEY);
	if (current) {
		let changed = false;
		for (const e of Object.values(current)) if (normalizeEntry(e)) changed = true;
		if (changed) localStorage.setItem(WORKSPACES_KEY, JSON.stringify(current));
		return current;
	}
	const merged: Record<string, WorkspaceEntry> = {};
	const entry = (root: string) => (merged[root] ??= {});
	for (const [root, v] of Object.entries(readJsonObject<Record<string, string>>(LEGACY_KEYS.main) ?? {})) {
		if (typeof v === 'string' && v) entry(root).main = v;
	}
	for (const [root, v] of Object.entries(readJsonObject<Record<string, string>>(LEGACY_KEYS.lastFile) ?? {})) {
		if (typeof v === 'string' && v) entry(root).lastFile = v;
	}
	for (const [root, v] of Object.entries(readJsonObject<Record<string, string>>(LEGACY_KEYS.cmd) ?? {})) {
		if (typeof v === 'string' && v) entry(root).compileCommand = v;
	}
	for (const [root, v] of Object.entries(readJsonObject<Record<string, CompileOutputs>>(LEGACY_KEYS.outputs) ?? {})) {
		if (v && typeof v === 'object') entry(root).outputs = v;
	}
	for (const e of Object.values(merged)) normalizeEntry(e);
	if (Object.keys(merged).length > 0) {
		localStorage.setItem(WORKSPACES_KEY, JSON.stringify(merged));
		for (const key of Object.values(LEGACY_KEYS)) localStorage.removeItem(key);
	}
	return merged;
}

// Windows hands out the same folder with varying drive-letter case (picker vs settings),
// so the stored key must be matched case-insensitively or a saved choice goes invisible
function keyFor(map: Record<string, unknown>, root: string): string {
	const k = norm(root);
	if (map[k] !== undefined) return k;
	const lower = k.toLowerCase();
	return Object.keys(map).find((x) => x.toLowerCase() === lower) ?? k;
}

function workspaceEntry(root: string): WorkspaceEntry {
	const map = loadWorkspaces();
	return map[keyFor(map, root)] ?? {};
}

/** read-modify-write one folder's entry; an entry with nothing left in it disappears entirely. */
function updateWorkspace(root: string, mutate: (entry: WorkspaceEntry) => void): void {
	if (!browser) return;
	const map = loadWorkspaces();
	const key = keyFor(map, root);
	const entry = map[key] ?? {};
	mutate(entry);
	if (Object.keys(entry).length > 0) map[key] = entry;
	else delete map[key];
	localStorage.setItem(WORKSPACES_KEY, JSON.stringify(map));
}

/** the persisted main-file path for a folder (absolute), or null if none was saved. */
export function savedMainFile(root: string): string | null {
	const rel = workspaceEntry(root).main;
	return rel ? absInRoot(root, rel) : null;
}

/** remembers (or clears) the chosen main file for a folder, and updates the live store. */
export function setMainFile(root: string, path: string | null): void {
	mainFile.set(path);
	updateWorkspace(root, (e) => {
		if (path) e.main = relInRoot(root, path);
		else delete e.main;
	});
}

/** the last file that was open in a folder (absolute), or null if none was recorded. */
export function savedLastFile(root: string): string | null {
	const rel = workspaceEntry(root).lastFile;
	return rel ? absInRoot(root, rel) : null;
}

/** records the file currently open in a folder (called on every active-file change). */
export function setLastFile(root: string, path: string): void {
	const rel = relInRoot(root, path);
	if (rel === norm(path)) return; // not under this root (mid folder-switch): never record cross-root
	updateWorkspace(root, (e) => {
		e.lastFile = rel;
	});
}

/** the folder's format switch; 'auto' when never set - every new workspace starts there. */
export function savedCompileFormat(root: string): CompileFormat {
	return workspaceEntry(root).compile ?? 'auto';
}

/** pins the format switch; 'auto' clears the field back to the default. */
export function setCompileFormat(root: string, format: CompileFormat): void {
	updateWorkspace(root, (e) => {
		if (format === 'auto') delete e.compile;
		else e.compile = format;
	});
}

/** the CONCRETE format in effect: a pin wins, Auto follows the main file's extension. */
export function effectiveCompileFormat(root: string | null, main: string | null): 'latex' | 'typst' {
	const pinned = root ? savedCompileFormat(root) : 'auto';
	if (pinned !== 'auto') return pinned;
	return main && /\.typ$/i.test(main) ? 'typst' : 'latex';
}

/** the saved command for ONE format's slot, or null when that slot is empty. */
export function savedFormatCommand(root: string, format: 'latex' | 'typst'): string | null {
	return workspaceEntry(root)[format]?.command ?? null;
}

/** saves (or clears) one format's command without touching the other format's slot. */
export function setFormatCommand(root: string, format: 'latex' | 'typst', cmd: string | null): void {
	updateWorkspace(root, (e) => {
		const cfg = e[format] ?? {};
		if (cmd) cfg.command = cmd;
		else delete cfg.command;
		if (cfg.command || cfg.outputs) e[format] = cfg;
		else delete e[format];
	});
}

/** one format's manual output-path overrides (empty object if none saved). */
export function savedFormatOutputs(root: string, format: 'latex' | 'typst'): CompileOutputs {
	return workspaceEntry(root)[format]?.outputs ?? {};
}

/** persists one format's output overrides; an all-blank set removes them. */
export function setFormatOutputs(root: string, format: 'latex' | 'typst', outputs: CompileOutputs): void {
	const clean: CompileOutputs = {};
	if (outputs.pdf) clean.pdf = outputs.pdf;
	if (outputs.log) clean.log = outputs.log;
	updateWorkspace(root, (e) => {
		const cfg = e[format] ?? {};
		if (clean.pdf || clean.log) cfg.outputs = clean;
		else delete cfg.outputs;
		if (cfg.command || cfg.outputs) e[format] = cfg;
		else delete e[format];
	});
}
