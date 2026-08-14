// "The compile run needed a program that isn't installed" - read out of what the shell printed.
// Pure: no DOM, no IPC, unit-testable.
//
// This asks the output WHICH program was missing, rather than asking whether one particular
// program was. Matching against the command's first word (what this used to do) got both ends
// wrong: `latexmk -lualatex` with lualatex missing says `bash: lualatex: command not found`, which
// names the engine and not latexmk, so nothing was reported at all; and `make` reporting its own
// child as `make: pdflatex: Command not found` matched the first word and blamed make, which is
// installed. Reading the name out of the line answers both correctly.
//
// The cost is that the program named may be a helper rather than the compiler - a missing biber or
// gs now gets reported. That is still the thing the user has to install.

/**
 * What each shell says, and where in the line the name sits.
 *
 *   zsh        zsh: command not found: latexmk
 *   bash/ksh   bash: line 1: latexmk: command not found
 *   make       make: pdflatex: Command not found          (a wrapper naming its child)
 *   dash/sh    sh: 1: latexmk: not found
 *   cmd.exe    'latexmk' is not recognized as an internal or external command,
 *   PowerShell The term 'latexmk' is not recognized as a name of a cmdlet...
 *
 * Order matters: zsh puts the name AFTER the phrase, so its pattern has to be tried before the
 * bash one, which would otherwise read zsh's own prefix ("zsh: command not found") as the name.
 */
const NOT_FOUND_PATTERNS: RegExp[] = [
	/command not found:\s*(\S+)/i,
	/(?:^|[\s:])([^\s:]+):\s*command not found/i,
	// dash/sh, the loose one: "not found" without the word "command". Anchored to a shell's own
	// prefix (sh, bash, dash, zsh, /bin/sh, all of which end in "sh") and its optional line number,
	// because `X: not found` on its own is a shape ordinary log text hits - "entering extended
	// mode: not found by the user" reported `mode` before this was pinned down.
	/^\s*\S*sh(?:\.exe)?:\s*(?:\d+:\s*)?([^\s:]+):\s*not found\b/i,
	/'([^']+)' is not recognized as an internal/i,
	/The term '([^']+)' is not recognized/i
];

/** a reported name as the user knows it: no quotes, no directory, no .exe */
function cleanName(raw: string): string {
	const unquoted = raw.replace(/^["']|["']$/g, '');
	return (unquoted.split(/[/\\]/).pop() ?? unquoted).replace(/\.exe$/i, '');
}

/**
 * The program the shell reported missing in `output`, or null when nothing was.
 *
 * First hit wins: a run that is missing two programs only ever gets as far as the first anyway.
 */
export function missingProgram(output: string): string | null {
	if (!output) return null;
	for (const line of output.split(/\r?\n/)) {
		for (const re of NOT_FOUND_PATTERNS) {
			const name = re.exec(line)?.[1];
			if (name) {
				const clean = cleanName(name);
				if (clean) return clean;
			}
		}
	}
	return null;
}

/**
 * Does this command send stderr somewhere other than the terminal?
 *
 * It matters because the shell writes its own "command not found" to the failed command's stderr,
 * which the redirect has already applied - so for a command like the Typst default
 * (`tinymist compile ... 2>out/x.log`) the evidence lands in the log file and never reaches the
 * captured output. Verified against both bash and cmd.exe.
 */
export function redirectsStderr(cmd: string): boolean {
	return /(?:^|\s)(?:2>|&>|>&)/.test(cmd);
}
