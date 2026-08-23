import type { TreeEntry } from '$lib/workspace/fileSystem';
import { gitKey } from '$lib/workspace/gitStore';
import type { GitBadge } from '$lib/workspace/git';
import { m } from '$lib/paraglide/messages';

export function gitBadgeOf(gitStatus: Record<string, GitBadge>, e: TreeEntry): GitBadge | undefined {
	return e.type === 'file' ? gitStatus[gitKey(e.path)] : undefined;
}

export const BADGE_COLOR: Record<GitBadge, string> = {
	M: 'text-amber-500',
	A: 'text-green-500',
	D: 'text-red-500',
	U: 'text-sky-500',
	R: 'text-violet-500'
};

export const BADGE_TITLE: Record<GitBadge, string> = {
	M: m.filetree_badge_modified(),
	A: m.filetree_badge_added(),
	D: m.filetree_badge_deleted(),
	U: m.filetree_badge_untracked(),
	R: m.filetree_badge_renamed()
};
