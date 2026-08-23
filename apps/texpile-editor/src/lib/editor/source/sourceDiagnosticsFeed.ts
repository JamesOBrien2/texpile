// Feeds compile-log problems into CodeMirror's lint state, narrowing each line-level
// diagnostic to the offending token and skipping dispatches that cannot change anything.
import type { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import type { SourceDiagnostic } from './sourceEditorTypes';

// narrows a line-level diagnostic to the offending token: the anchor text (the log's l.NN
// context tail, or a \ref/\cite key) re-locates the error point even when the buffer drifted
// since the compile; the raw column is the fallback, the whole line the last resort.
function diagnosticRange(doc: EditorState['doc'], d: SourceDiagnostic): { from: number; to: number } {
	const startLine = doc.line(Math.min(d.line, doc.lines));
	const endLine = doc.line(Math.min(d.lineEnd ?? d.line, doc.lines));
	if (d.lineEnd === undefined) {
		if (d.anchorText) {
			const at = startLine.text.indexOf(d.anchorText);
			if (at !== -1) {
				// a \ref/\cite key anchors ON itself
				if (d.token === undefined && !d.anchorText.includes('\\')) {
					return { from: startLine.from + at, to: startLine.from + at + d.anchorText.length };
				}
				// an l.NN tail ENDS at the error point: the offending token is its last chars
				const errPoint = at + d.anchorText.length;
				const len = Math.max(1, d.token?.length ?? 1);
				const from = startLine.from + Math.max(at, errPoint - len);
				return { from, to: Math.min(startLine.to, startLine.from + errPoint) };
			}
		}
		if (d.column !== undefined && d.column - 1 <= startLine.length) {
			const from = startLine.from + Math.max(0, d.column - 1 - Math.max(0, d.token?.length ?? 0));
			return { from, to: Math.min(startLine.to, from + Math.max(1, d.token?.length ?? 1)) };
		}
	}
	return { from: startLine.from, to: Math.max(endLine.to, startLine.from) };
}

export class SourceDiagnosticsFeed {
	// dispatching setDiagnostics re-runs every StateField, so skip when nothing can change:
	// empty mapped onto empty, or the same list on an unchanged doc (re-anchoring only matters
	// once either of them moved)
	private lastDoc: EditorState['doc'] | null = null;
	private lastList: SourceDiagnostic[] | null = null;
	private lastEmpty = true;

	apply(view: EditorView, list: SourceDiagnostic[]): void {
		const doc = view.state.doc;
		const valid = list.filter((d) => Number.isInteger(d.line) && d.line >= 1);
		if (valid.length === 0 && this.lastEmpty) return;
		if (list === this.lastList && doc === this.lastDoc) return;
		const mapped: Diagnostic[] = valid.map((d) => ({
			...diagnosticRange(doc, d),
			severity: d.severity,
			message: d.message,
			source: 'latex'
		}));
		view.dispatch(setDiagnostics(view.state, mapped));
		this.lastDoc = doc;
		this.lastList = list;
		this.lastEmpty = mapped.length === 0;
	}
}
