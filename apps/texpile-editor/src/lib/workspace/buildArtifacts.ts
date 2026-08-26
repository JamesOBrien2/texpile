// The compiler's scratch files - not the output PDF, which is the artifact of record: what was
// submitted and what a reviewer read, and toolchains drift, so "just recompile it" is not a promise
// the future keeps. Versions here are deliberate, not one per compile, so the bytes are affordable.
//
// The ONE list; the collab share filter and the path-completion junk filter had already drifted.

/** rewritten wholesale by every compile. glsdefs was missing from both lists this replaced. */
export const LATEX_SIDECAR_RE =
	/\.(log|aux|toc|lof|lot|out|bbl|blg|bcf|fls|fdb_latexmk|synctex|synctex\.gz|xdv|dvi|run\.xml|nav|snm|vrb|idx|ilg|ind|glo|gls|glsdefs|glg|ist|spl)$/i;

/** Draft mode's transient compile area; the tree walker already hides it (walkIgnoreRules). */
const DRAFT_DIR_RE = /(^|[\\/])_draft([\\/]|$)/;

/** the output PDF is deliberately NOT one of these */
export function isBuildArtifact(path: string): boolean {
	return LATEX_SIDECAR_RE.test(path) || DRAFT_DIR_RE.test(path);
}

/**
 * .gitignore lines for this compile format; Typst and Markdown have no sidecars, so only _draft/.
 */
export function gitignoreLines(format: 'latex' | 'typst'): string[] {
	// no PDF line, deliberately: the output document is part of the paper's history, and a '*.pdf'
	// glob would take the figures with it
	const lines = ['# Texpile: compile scratch', '_draft/'];
	if (format === 'latex') {
		lines.push(
			'*.aux',
			'*.bbl',
			'*.bcf',
			'*.blg',
			'*.dvi',
			'*.fdb_latexmk',
			'*.fls',
			'*.glg',
			'*.glo',
			'*.gls',
			'*.glsdefs',
			'*.idx',
			'*.ilg',
			'*.ind',
			'*.ist',
			'*.lof',
			'*.log',
			'*.lot',
			'*.nav',
			'*.out',
			'*.run.xml',
			'*.snm',
			'*.spl',
			'*.synctex',
			'*.synctex.gz',
			'*.toc',
			'*.vrb',
			'*.xdv'
		);
	}
	return lines;
}
