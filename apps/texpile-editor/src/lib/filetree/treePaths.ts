// path arithmetic on tree entry paths, which keep whichever separator the OS handed us
import type { TreeEntry } from '$lib/workspace/fileSystem';

export function sepOf(p: string): string {
	return p.includes('\\') ? '\\' : '/';
}

export function parentOf(p: string): string {
	const i = p.lastIndexOf(sepOf(p));
	return i >= 0 ? p.slice(0, i) : p;
}

/** the directory a drop on this entry would land in */
export function dropDir(entry: TreeEntry): string {
	return entry.type === 'dir' ? entry.path : parentOf(entry.path);
}

export function isInside(path: string, ancestor: string): boolean {
	return path.startsWith(ancestor + sepOf(ancestor));
}
