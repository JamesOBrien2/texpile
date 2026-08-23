// parses the folder's .bib files into the shared references store; read-only
import { writable } from 'svelte/store';
import { parseBibTeX, type BibLaTeXReference } from '$lib/languages/bib/biblatex';
import { extractDocRefs, type BibItemSlice } from '$lib/languages/latex/parser/labels';
import { scanFiles, readTextFile, type TexFile } from './fileSystem';

export type { BibLaTeXReference };

/** references from the folder's .bib files, also fed to the editor for @-cites. */
export const references = writable<BibLaTeXReference[]>([]);

/** parses several .bib texts into one list, de-duplicated by key (first occurrence wins). */
export function mergeReferences(texts: string[]): BibLaTeXReference[] {
	const all: BibLaTeXReference[] = [];
	const seen = new Set<string>();
	for (const text of texts) {
		let parsed: BibLaTeXReference[] = [];
		try {
			parsed = parseBibTeX(text);
		} catch {
			continue; // skip an unparseable file rather than failing the whole load
		}
		for (const ref of parsed) {
			if (ref.key && !seen.has(ref.key)) {
				seen.add(ref.key);
				all.push(ref);
			}
		}
	}
	return all;
}

/**
 * Turns \bibitem slices into loose references so @-citations work without a .bib file.
 * Only key is reliable; author/title/year are display heuristics over the free text.
 */
export function bibItemsToReferences(items: BibItemSlice[]): BibLaTeXReference[] {
	const out: BibLaTeXReference[] = [];
	for (const item of items) {
		const { key } = item;
		// display cleanup only, the raw slice stays untouched
		const body = item.body.replace(/\s+/g, ' ').replace(/[{}]/g, '').replace(/~/g, ' ').replace(/\\&/g, '&').trim();
		const ref: BibLaTeXReference = { key, entrytype: 'misc', fromBibitem: true, raw: `\\bibitem{${key}} ${item.body.trim()}` };
		const titleM = body.match(/``(.+?)''/) ?? body.match(/[“"](.+?)[”"]/);
		if (titleM) {
			ref.title = titleM[1].trim().replace(/[,.]$/, '');
			const before = body.slice(0, titleM.index).replace(/[,\s]+$/, '');
			if (before) ref.author = before;
		} else {
			// no quoted title (books etc.): treat "Name, Rest of citation" as author, title
			const comma = body.indexOf(',');
			if (comma > 0) {
				ref.author = body.slice(0, comma).trim();
				const rest = body
					.slice(comma + 1)
					.trim()
					.replace(/\.$/, '');
				if (rest) ref.title = rest.length > 90 ? `${rest.slice(0, 90)}…` : rest;
			} else if (body) {
				ref.title = body.length > 90 ? `${body.slice(0, 90)}…` : body;
			}
		}
		const years = body.match(/\b(?:1[89]|20)\d{2}\b/g);
		if (years?.length) ref.year = years[years.length - 1];
		out.push(ref);
	}
	return out;
}

/**
 * Best-effort \bibitem parse from a .tex (thebibliography). AST-scanned, so a commented or
 * verbatim \bibitem doesn't count. Callers already running extractDocRefs should reuse its result.
 */
export function parseBibItems(tex: string): BibLaTeXReference[] {
	return bibItemsToReferences(extractDocRefs(tex).bibitems);
}

/** what loadReferences reads through: native fs by default, the workspace provider for a guest
 *  session (whose "files" live in the shared doc, not on this machine's disk). */
export type ReferencesFs = {
	scan(root: string, exts: string[]): Promise<TexFile[]>;
	read(path: string): Promise<string>;
};
const nativeFs: ReferencesFs = { scan: (r, e) => scanFiles(r, e).then((x) => x.files), read: readTextFile };

// stale-load guard: reloads fire on every save and every window focus, and an older scan landing
// after a newer one would publish stale entries
let loadSeq = 0;

/** parses all .bib files in the folder, merged; references.bib wins on key clashes.
 *  The store is NOT cleared up front: it used to be, and the empty window while the folder
 *  rescanned made every citation chip downgrade to its raw key and snap back - a visible flash
 *  on each save. The old list stays up until the fresh one replaces it in a single set. */
export async function loadReferences(root: string, fs: ReferencesFs = nativeFs): Promise<void> {
	const my = ++loadSeq;
	try {
		const files = await fs.scan(root, ['bib']);
		if (my !== loadSeq) return;
		if (!files.length) {
			references.set([]);
			return;
		}
		// read references.bib first so its entries take precedence in the de-dupe
		const ordered = [...files].sort(
			(a, b) => Number(b.name.toLowerCase() === 'references.bib') - Number(a.name.toLowerCase() === 'references.bib')
		);
		const texts: string[] = [];
		for (const f of ordered) {
			try {
				texts.push(await fs.read(f.path));
			} catch {
				/* skip unreadable file */
			}
		}
		if (my !== loadSeq) return;
		references.set(mergeReferences(texts));
	} catch (e) {
		console.error('Failed to load references:', e);
		if (my === loadSeq) references.set([]);
	}
}
