// The inline-`code` tokenizer for Prose.svelte, kept out of the component so it can be exercised
// directly. Its failure mode is silent deletion rather than an error, so it is worth being able to
// call in isolation.

export type Token = { text: string; color?: string; class?: string };

// \command | backslash + any single char | {argument} | a run of plain text | any single char.
//
// The last two alternatives are the fix, not decoration. String.match(/g) SKIPS any position the
// pattern cannot match rather than failing, so an alternation with a gap silently deletes
// characters from the output. The gap was a backslash followed by anything that is not a letter:
// `%USERPROFILE%\.local\bin` rendered as `%USERPROFILE%.local\bin`, and neither svelte-check nor
// the build could have caught it - both were green. A trailing catch-all is what makes the
// tokenizer total, so every character of the input reaches a token.
const TOKEN_RE = /\\[a-zA-Z]+|\\[\s\S]|\{[^}]*\}|[^\\{}]+|[\s\S]/g;

// Only a real command gets the command colour. `\.` and `\{` also start with a backslash but are
// literal text, so first-character matching is not enough to classify them.
const COMMAND_RE = /^\\(\\|[a-zA-Z]+)$/;

/** Safe to share the module-level TOKEN_RE: String.match with a /g regex restarts from 0 itself
 *  (unlike .test/.exec, which carry lastIndex between calls). */
export function tokenize(code: string): Token[] {
	const tokens: Token[] = [];
	for (const t of code.match(TOKEN_RE) ?? []) {
		if (COMMAND_RE.test(t)) {
			tokens.push({ text: t, color: '#6F42C1' }); // command name
		} else if (t.length >= 2 && t.startsWith('{') && t.endsWith('}')) {
			tokens.push({ text: '{', class: 'text-surface-400' });
			if (t.length > 2) tokens.push({ text: t.slice(1, -1), color: '#032F62' }); // argument
			tokens.push({ text: '}', class: 'text-surface-400' });
		} else {
			tokens.push({ text: t, class: 'text-surface-800' });
		}
	}
	return tokens;
}
