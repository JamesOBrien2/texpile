// Import-time coalescing of adjacent raw source islands.
//
// A stack of comment lines, or \bibliographystyle + \bibliography, imports as one raw block per
// line - a wall of separate boxes in the visual editor. This pass runs once on a freshly imported
// doc (LaTeX and Typst; the orig bookkeeping is dialect-neutral) and merges each such run into a
// single raw_latex block whose text is the EXACT source slice of the whole run, inter-block
// whitespace included. Merging never invents or reorders bytes: it only happens when the members'
// seq numbers prove source adjacency and the gaps between them are pure whitespace.
//
// It runs BEFORE norm filling, so the merged block gets its own norm and stays on the verbatim
// re-emission path; a member that could not carry a source slice disqualifies its run.
import { Fragment } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';

interface Orig {
	latex?: string | null;
	pre?: string | null;
	seq?: number | null;
	group?: number | null;
	start?: number | null;
}

function origOf(node: PMNode): Orig | null {
	const o = (node.attrs as { orig?: unknown }).orig;
	return o && typeof o === 'object' ? (o as Orig) : null;
}

// a paragraph that is nothing but raw chips (plus breaks/whitespace): already uneditable as
// prose, so it may join a raw island run - \bibliographystyle imports as exactly this shape
function isChipParagraph(node: PMNode): boolean {
	if (node.type.name !== 'paragraph') return false;
	let chips = 0;
	let pure = true;
	node.forEach((child) => {
		if (child.type.name === 'inline_latex' && child.marks.length === 0) chips++;
		else if (child.type.name === 'hard_break' || (child.isText && (child.text ?? '').trim() === '')) {
			// structural filler, fine
		} else pure = false;
	});
	return pure && chips > 0;
}

function mergeable(node: PMNode): boolean {
	const o = origOf(node);
	// no slice, or part of a multi-block group: the bytes can't be joined safely
	if (!o || typeof o.latex !== 'string' || !o.latex || typeof o.seq !== 'number' || o.group != null) return false;
	return node.type.name === 'raw_latex' || isChipParagraph(node);
}

/** may `node` extend a run ending in `prev`? adjacency is proven by seq, the gap must be pure
 *  whitespace, and raw blocks must agree on their dialect tag */
function extendsRun(prev: PMNode, node: PMNode): boolean {
	if (!mergeable(node)) return false;
	const a = origOf(prev)!;
	const b = origOf(node)!;
	if (b.seq !== (a.seq as number) + 1) return false;
	if (typeof b.pre !== 'string' || b.pre.trim() !== '') return false;
	if (prev.type.name === 'raw_latex' && node.type.name === 'raw_latex' && String(prev.attrs.lang ?? '') !== String(node.attrs.lang ?? ''))
		return false;
	return true;
}

/**
 * Merge runs of adjacent raw islands in a top-level doc. Returns the doc unchanged (same object)
 * when there is nothing to merge. seq numbers are re-stamped positionally afterwards - at import
 * time they are dense and positional by construction, so this preserves every adjacency fact -
 * and docTail.afterSeq follows the last block's new seq.
 */
export function mergeAdjacentRawBlocks(doc: PMNode): PMNode {
	const n = doc.childCount;
	const out: PMNode[] = [];
	let merged = false;
	// trailing whitespace trimmed off a merged island, owed to the NEXT block's `pre` (or the
	// docTail) so the byte count of the file never changes
	let carry = '';
	// whether the very last emission may push its trailing trim into docTail.text
	let carryIntoTail = false;

	const tail = (doc.attrs as { docTail?: { text?: string | null; afterSeq?: number | null } }).docTail;

	for (let i = 0; i < n;) {
		let j = i;
		if (mergeable(doc.child(i))) {
			while (j + 1 < n && extendsRun(doc.child(j), doc.child(j + 1))) j++;
		}
		// a run must actually contain a raw block; two adjacent chip paragraphs stay paragraphs
		let hasRaw = false;
		for (let k = i; k <= j; k++) if (doc.child(k).type.name === 'raw_latex') hasRaw = true;
		if (j === i || !hasRaw) {
			const child = doc.child(i);
			const o = origOf(child);
			if (carry && o && typeof o.pre === 'string') {
				out.push(child.type.create({ ...child.attrs, orig: { ...o, pre: carry + o.pre } }, child.content, child.marks));
				carry = '';
			} else {
				out.push(child);
			}
			i++;
			continue;
		}

		const first = origOf(doc.child(i))!;
		let text = carry + String(first.latex);
		carry = '';
		for (let k = i + 1; k <= j; k++) {
			const o = origOf(doc.child(k))!;
			text += String(o.pre) + String(o.latex);
		}

		// The slices carry their boundary newlines (a comment's extent includes the line break),
		// but the block's TEXT should not open or close on blank lines. Trim both edges and rehome
		// the bytes: the lead into this block's own `pre`, the trail into whatever comes next -
		// only where a home exists, so no byte is ever dropped.
		const lead = /^\s*/.exec(text)![0];
		const pre = String(first.pre ?? '') + lead;
		text = text.slice(lead.length);
		const next = j + 1 < n ? origOf(doc.child(j + 1)) : null;
		// a home for the trail: the next block's pre, a valid docTail, or - for a run that ends the
		// body with no docTail at all - a docTail created for exactly this purpose
		const canCarry =
			(next && typeof next.pre === 'string') || (j + 1 === n && (!tail || (typeof tail.text === 'string' && tail.afterSeq === n - 1)));
		if (canCarry) {
			const trail = /\s*$/.exec(text)![0];
			text = text.slice(0, text.length - trail.length);
			carry = trail;
			if (j + 1 === n && carry) carryIntoTail = true;
		}
		if (!text) {
			// nothing but whitespace survived: leave the run untouched rather than invent an island
			for (let k = i; k <= j; k++) out.push(doc.child(k));
			carry = '';
			carryIntoTail = false;
			i = j + 1;
			continue;
		}

		const rawMember = (() => {
			for (let k = i; k <= j; k++) if (doc.child(k).type.name === 'raw_latex') return doc.child(k);
			return doc.child(i);
		})();
		const type = rawMember.type;
		const attrs: Record<string, unknown> = {
			...('lang' in (type.spec.attrs ?? {}) ? { lang: rawMember.attrs.lang } : {}),
			orig: { latex: text, pre, seq: first.seq, norm: null, start: (first.start ?? 0) + lead.length }
		};
		out.push(type.create(attrs, type.schema.text(text)));
		merged = true;
		i = j + 1;
	}

	if (!merged) return doc;

	// re-stamp seq positionally (every child consumes a number, orig attr or not, mirroring how
	// the converters allocate them)
	const restamped = out.map((child, i) => {
		const o = origOf(child);
		if (!o || o.seq === i) return child;
		return child.type.create({ ...child.attrs, orig: { ...o, seq: i } }, child.content, child.marks);
	});

	const attrs: Record<string, unknown> = { ...doc.attrs };
	if (tail && typeof tail.afterSeq === 'number' && tail.afterSeq === n - 1) {
		attrs.docTail = {
			...tail,
			afterSeq: restamped.length - 1,
			...(carryIntoTail ? { text: carry + String(tail.text ?? '') } : {})
		};
	} else if (carryIntoTail && !tail) {
		attrs.docTail = { text: carry, afterSeq: restamped.length - 1 };
	}
	return doc.type.create(attrs, Fragment.fromArray(restamped), doc.marks);
}
