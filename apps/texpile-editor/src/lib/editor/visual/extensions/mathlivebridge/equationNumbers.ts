// JS-rendered "(1)" line numbers for per-line environments (align, gather); single-label
// environments and plain equations use CSS ::after fed by data-equation-number.
import type { EditorView } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import { SINGLE_LABEL_ENVIRONMENTS } from './mathEnvironments';

/** equation numbers are sequential across the whole doc, count everything numbered before this node. */
function equationStartNumber(view: EditorView, myPos: number): number {
	let count = 1;

	view.state.doc.descendants((n, pos) => {
		if (pos >= myPos) return false;

		if (n.type.name === 'block_math' && n.attrs.numbered) {
			const nodeLineLabels = (n.attrs.lineLabels as string[]) || [];
			const nodeEnv = n.attrs.environment || '';
			const isSingleLabel = (SINGLE_LABEL_ENVIRONMENTS as readonly string[]).includes(nodeEnv);

			if (isSingleLabel) {
				count++;
			} else if (nodeLineLabels.length > 0) {
				count += nodeLineLabels.filter((l) => l && l.trim()).length;
			} else if (n.attrs.label) {
				count++;
			}
		}
	});

	return count;
}

/* eslint-disable no-param-reassign -- rendering writes the handed container */
export function renderEquationNumbers(view: EditorView, node: Node, dom: HTMLElement, container: HTMLElement, myPos: number): void {
	const isNumbered = node.attrs.numbered;
	const environment = node.attrs.environment;
	const lineLabels = (node.attrs.lineLabels as string[]) || [];

	container.innerHTML = '';

	const startingNumber = equationStartNumber(view, myPos);

	// CSS ::after reads this for single-line equations
	dom.setAttribute('data-equation-number', String(startingNumber));

	const isSingleLabelEnv = (SINGLE_LABEL_ENVIRONMENTS as readonly string[]).includes(environment || '');

	if (!isNumbered || !environment || isSingleLabelEnv) {
		container.style.display = 'none';
		return;
	}

	const effectiveLineCount = Math.max(lineLabels.length, 1);

	container.style.display = 'flex';

	for (let i = 0; i < effectiveLineCount; i++) {
		const numEl = document.createElement('span');
		numEl.className = 'equation-number-line';
		numEl.textContent = `(${startingNumber + i})`;
		numEl.setAttribute('data-line-label', lineLabels[i] || '');
		container.appendChild(numEl);
	}
}
