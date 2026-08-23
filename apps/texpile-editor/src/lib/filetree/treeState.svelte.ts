// Which folders are open and which rows are selected, plus the click grammar that drives
// both (plain / ctrl / shift, VSCode-style).
import type { TreeEntry } from '$lib/workspace/fileSystem';
import { isInside } from './treePaths';

type StateHooks = {
	tree: () => TreeEntry[];
	onOpen: (entry: TreeEntry) => void;
};

export class FileTreeState {
	expanded = $state<Record<string, boolean>>({});
	selected = $state<string[]>([]);
	anchorPath: string | null = null; // shift-range pivot; the last plain/ctrl-clicked row

	constructor(private hooks: StateHooks) {}

	/** the tree in on-screen order, honouring which folders are expanded (shift-range domain). */
	private flattenVisible(entries: TreeEntry[] = this.hooks.tree(), out: TreeEntry[] = []): TreeEntry[] {
		for (const e of entries) {
			out.push(e);
			if (e.type === 'dir' && this.expanded[e.path]) this.flattenVisible(e.children ?? [], out);
		}
		return out;
	}

	findEntry(path: string, entries: TreeEntry[] = this.hooks.tree()): TreeEntry | null {
		for (const e of entries) {
			if (e.path === path) return e;
			if (e.type === 'dir') {
				const hit = this.findEntry(path, e.children ?? []);
				if (hit) return hit;
			}
		}
		return null;
	}

	/** selected entries with nested ones pruned; a child handled after its parent moved is a dead path */
	selectedEntries(): TreeEntry[] {
		const paths = this.selected.filter((p) => !this.selected.some((other) => other !== p && isInside(p, other)));
		return paths.map((p) => this.findEntry(p)).filter((e): e is TreeEntry => !!e);
	}

	/** collapse the selection onto this row unless it is already part of it */
	ensureSelected(entry: TreeEntry): void {
		if (!this.selected.includes(entry.path)) {
			this.selected = [entry.path];
			this.anchorPath = entry.path;
		}
	}

	handleRowClick(e: MouseEvent, entry: TreeEntry): void {
		if (e.ctrlKey || e.metaKey) {
			this.selected = this.selected.includes(entry.path) ? this.selected.filter((p) => p !== entry.path) : [...this.selected, entry.path];
			this.anchorPath = entry.path;
			return;
		}
		if (e.shiftKey && this.anchorPath) {
			const order = this.flattenVisible().map((x) => x.path);
			const a = order.indexOf(this.anchorPath);
			const b = order.indexOf(entry.path);
			if (a >= 0 && b >= 0) {
				this.selected = order.slice(Math.min(a, b), Math.max(a, b) + 1);
				return;
			}
		}
		this.selected = [entry.path];
		this.anchorPath = entry.path;
		if (entry.type === 'dir') this.expanded[entry.path] = !this.expanded[entry.path];
		else this.hooks.onOpen(entry);
	}
}
