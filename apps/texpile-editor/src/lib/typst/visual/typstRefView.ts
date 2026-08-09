// NodeView for typ_ref (`@target`): a chip that resolves its target against the loaded
// bibliography at render time. A hit shows author/year in the tooltip and takes the citation
// tint; a miss is (or may be) a label cross-reference and stays neutral. The DOC carries only
// the target - classification is pure display, which is what makes @key round-trip safe
// whichever of typst's two meanings it has.
import type { Node as PMNode } from 'prosemirror-model';
import type { NodeView } from 'prosemirror-view';
import { get } from 'svelte/store';
import { referenceStore } from '$lib/stores/editorStore';

export default class TypstRefView implements NodeView {
	dom: HTMLElement;
	node: PMNode;

	constructor(node: PMNode) {
		this.node = node;
		this.dom = document.createElement('span');
		this.dom.contentEditable = 'false';
		this.render(node);
	}

	private render(node: PMNode): void {
		const target = String(node.attrs.target ?? '');
		this.dom.textContent = `@${target}`;
		const ref = get(referenceStore).find((r) => r.key === target);
		this.dom.className = ref ? 'typ-ref typ-ref-known' : 'typ-ref';
		if (ref) {
			const bits = [ref.author, ref.year ?? ref.date, ref.title].filter(Boolean);
			this.dom.title = bits.join(' - ') || target;
		} else {
			this.dom.title = target;
		}
	}

	update(node: PMNode): boolean {
		if (node.type !== this.node.type) return false;
		this.node = node;
		this.render(node);
		return true;
	}
}
