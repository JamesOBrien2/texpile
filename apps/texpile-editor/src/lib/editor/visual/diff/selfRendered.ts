// Nodes whose content ProseMirror does not draw, so a mark has to sit ON them: an inline
// decoration inside a CodeMirror island or a MathLive formula has no text node to attach to.
//
// Deliberately NOT shared with the cursor plugin's lookalike list, which answers "does the browser
// paint a selection here" and so excludes the chips. Unify them and one breaks quietly.
import type { Node as PMNode } from 'prosemirror-model';

/** not atoms, but their text belongs to CodeMirror */
const CODEMIRROR_BACKED = new Set(['code_block', 'raw_latex', 'inline_latex']);

/** isAtom covers the rest in all three dialects without naming each one */
export function isSelfRendered(node: PMNode): boolean {
	if (node.isText) return false;
	return node.isAtom || CODEMIRROR_BACKED.has(node.type.name);
}
