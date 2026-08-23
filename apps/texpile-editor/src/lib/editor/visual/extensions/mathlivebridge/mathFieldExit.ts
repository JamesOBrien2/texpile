// Leaving or emptying a math field: two-step delete-when-empty (first backspace marks the
// field pending, the second removes the node) and cursor escape past either edge.
import { Selection } from 'prosemirror-state';
import { setTextSelection } from 'prosemirror-utils';
import type { EditorView } from 'prosemirror-view';
import type { Node } from 'prosemirror-model';
import type { MathfieldElement } from 'mathlive';

type ExitHost = {
	view: EditorView;
	getPos: () => number;
	node: () => Node;
	/** the live field, or the static placeholder before materialize() */
	host: () => HTMLElement;
	isEmpty: () => boolean;
	deselect: () => void;
};

/** empty fields get a red border even when blurred. */
/* eslint-disable no-param-reassign -- styling writes the handed element */
export function applyMathOutline(target: HTMLElement, empty: boolean, pendingDelete: boolean, focus: boolean): void {
	if (empty) {
		// keep pending-delete styling if active
		if (!pendingDelete) {
			target.style.border = '1px solid var(--color-error-500, #ef4444)';
			target.style.backgroundColor = 'transparent';
		}
		target.style.outline = 'none';
		return;
	}
	target.style.backgroundColor = 'transparent';
	// var, not #000: a black ring is invisible against the dark-mode editor background
	target.style.border = focus ? '1px solid var(--mathfield-focus-border, #000)' : 'none';
	target.style.outline = 'none';
}
/* eslint-enable no-param-reassign */

export class MathFieldExit {
	// empty + one backspace = pending, second backspace or blur deletes
	pendingDelete = false;

	constructor(private h: ExitHost) {}

	maybedelete(dir = 1): boolean {
		if (this.h.isEmpty()) {
			if (!this.pendingDelete) {
				this.pendingDelete = true;
				this.h.host().style.border = '1px solid var(--color-error-500, #ef4444)';
				this.h.host().style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
				return true; // keep the cursor inside
			}

			const pos = this.h.getPos();
			let tr = this.h.view.state.tr;

			tr.delete(pos, pos + this.h.node().nodeSize);
			tr = setTextSelection(pos, dir)(tr);

			this.h.view.dispatch(tr);
			this.h.view.focus();
			return true;
		}
		this.pendingDelete = false;
		this.h.host().style.backgroundColor = 'transparent';
		return false;
	}

	keydown(event: KeyboardEvent, field: MathfieldElement): void {
		if (event.key === 'Backspace') {
			if (field.selection.ranges[0][0] !== field.selection.ranges[0][1] || field.selection.ranges[0][1] !== 0) {
				return;
			}
			if (!this.maybedelete(-1) && field.selection.ranges) {
				let tr = this.h.view.state.tr;
				tr = setTextSelection(this.h.getPos(), -1)(tr);

				this.h.view.dispatch(tr);
				this.h.view.focus();
			}
		}
	}

	maybeEscape(dir: string): void {
		if (dir == 'backward') {
			this.maybedelete(-1);
			this.h.deselect();
			this.h.view.focus();
			const tr = this.h.view.state.tr;
			const targetPos = this.h.getPos();
			// Selection.near falls back to a GapCursor when there's no text position
			const resolvedPos = tr.doc.resolve(targetPos);
			tr.setSelection(Selection.near(resolvedPos, -1));
			this.h.view.dispatch(tr);
		} else if (dir == 'forward') {
			this.maybedelete(1);

			this.h.deselect();
			this.h.view.focus();
			const tr = this.h.view.state.tr;
			const targetPos = this.h.getPos() + this.h.node().nodeSize;
			const resolvedPos = tr.doc.resolve(targetPos);
			tr.setSelection(Selection.near(resolvedPos, 1));
			this.h.view.dispatch(tr);
		}
	}
}
