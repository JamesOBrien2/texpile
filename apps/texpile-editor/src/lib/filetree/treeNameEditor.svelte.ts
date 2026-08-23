// The inline name inputs: creating a file/folder/include and renaming an entry. Blur is not
// consent - an untouched field losing focus dismisses rather than accepts the pre-fill.
import type { TreeEntry } from '$lib/workspace/fileSystem';

type EditorHooks = {
	rootPath: () => string;
	expand: (dir: string) => void;
	onCreate: (parentDir: string, name: string, type: 'file' | 'dir' | 'include') => void;
	onRename: (entry: TreeEntry, newName: string) => void;
};

export class TreeNameEditor {
	creatingIn = $state<string | null>(null);
	createType = $state<'file' | 'dir' | 'include'>('file');
	createValue = $state('');
	createEdited = $state(false); // did the user actually type, or is this still our pre-fill?
	renaming = $state<string | null>(null);
	renameValue = $state('');
	renameEdited = $state(false);

	constructor(private hooks: EditorHooks) {}

	startCreate(dir: string, type: 'file' | 'dir' | 'include', defaultName = ''): void {
		this.creatingIn = dir;
		this.createType = type;
		this.createValue = defaultName;
		this.createEdited = false;
		if (dir !== this.hooks.rootPath()) this.hooks.expand(dir);
	}

	commitCreate(): void {
		const v = this.createValue.trim();
		const dir = this.creatingIn;
		this.creatingIn = null;
		this.createValue = '';
		if (v && dir) this.hooks.onCreate(dir, v, this.createType);
	}

	// decided a frame late, because the menu/focusSelect handoff blurs it spuriously first
	blurCreate(e: FocusEvent): void {
		if (this.createEdited) {
			this.commitCreate();
			return;
		}
		const input = e.currentTarget as HTMLElement;
		requestAnimationFrame(() => {
			if (this.creatingIn !== null && document.activeElement !== input) this.cancelCreate();
		});
	}

	cancelCreate(): void {
		this.creatingIn = null;
		this.createValue = '';
	}

	startRename(e: TreeEntry): void {
		this.renaming = e.path;
		this.renameValue = e.name;
		this.renameEdited = false;
	}

	commitRename(e: TreeEntry): void {
		if (this.renaming !== e.path) return; // guard against Enter + blur double-firing
		this.renaming = null;
		const v = this.renameValue.trim();
		if (v && v !== e.name) this.hooks.onRename(e, v);
	}

	/** same deferred-dismiss reasoning as blurCreate. */
	blurRename(e: FocusEvent, entry: TreeEntry): void {
		if (this.renameEdited) {
			this.commitRename(entry);
			return;
		}
		const input = e.currentTarget as HTMLElement;
		requestAnimationFrame(() => {
			if (this.renaming === entry.path && document.activeElement !== input) this.renaming = null;
		});
	}
}
