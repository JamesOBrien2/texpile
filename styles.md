# Code Style Guide

## Naming Conventions

TLDR: Generally, follow Java Coding Conventions, don't force OOP, use class when needed.

1. Classes, interfaces, types, enums: PascalCase. UserProfile, EditorState
2. Methods and functions: camelCase, verb first. parseDocument, resolveSelection
3. Variables and fields: camelCase. activeEditor, pendingChanges
4. Constants: SCREAMING_SNAKE_CASE. MAX_RETRY_COUNT, DEFAULT_THEME
5. Enum members: SCREAMING_SNAKE_CASE. Status.IN_PROGRESS
6. Type parameters: single capital letter or short PascalCase. T, TNode
7. Packages: all lowercase, no underscores
8. Booleans: is, has, can, should prefix. isDirty, hasUnsavedChanges
9. No abbreviations unless universally known. configuration not cfg
10. Acronyms are treated as words. HtmlParser not HTMLParser, parseUrl not parseURL

Exceptions and amendments for this project:

1. Svelte components: PascalCase file and component name, matching each other. EditorToolbar.svelte
2. Non component files: camelCase. resolveSelection.ts, editorState.svelte.ts
3. Folders: camelCase, except a folder wrapping a split component, which takes that component's PascalCase name
4. Type files: name.types.ts beside the file they serve
5. No get or set prefixes. Use bare properties, or get foo() when a computed read is needed. getUserProfile() only when it does real work such as fetching or parsing
6. No I prefix on interfaces, no Impl suffix. Name the interface for the concept and the implementation for how it does it
7. No Abstract prefix
8. Prefer type over interface unless declaration merging is needed
9. Library aliasing: when two libraries occupy the same space, alias both. CodeMirror imports as CMView, ProseMirror as PMView. Never alias only one
10. The acronym rule does not apply to the deliberate library aliases above

## File Structure

1. More files with less LOC > 1 file with more LOC. If a component can be separated into sub components, prefer separating it into sub components
2. ~250 LOC is a soft benchmark, not a hard cap; lint warns at 400 effective lines (blank lines and comments excluded). Exceeding the benchmark is fine for files with easy to understand intentions such as a list of words or a super long map
3. When a file is split, break it into a folder named after the component. EditorToolbar/ holds EditorToolbar.svelte, EditorToolbar.types.ts, editorToolbarState.svelte.ts
4. Type definitions go into a type file, exception for super short files
5. UI goes into .svelte, pure logic stays in .ts or .svelte.ts. NEVER put more ts logic than needed to drive the UI in .svelte
6. Use .svelte.ts only when the file needs Svelte to process it, for instance when using runes. Plain .ts otherwise

## Code Structure

1. Declare constants at the very top of the file only, and in CAPS
2. Use functions instead of () => if possible. Exception: inline callbacks and anything passed directly as an argument
3. Immutable design as much as possible. Mutable creates unnecessary races
4. Return new values instead of editing arguments. No function should modify what it was given
5. Reactive collections are replaced, never mutated: build a fresh Map/Set/array and reassign it to the $state field. In-place mutation of a collection a template, $derived, or $effect reads is the one shape that goes stale silently

## Naming and Comments

1. File and folder names should be expressive enough that each file requires 0 top of the file comments. Top of the file comments should be avoided as much as possible
2. Function names should be descriptive. Do not use simple names like load, load what? Variable names should be just as clear
3. Comments should be avoided as much as possible. In most cases, if you need a comment, making that part of the code a separate function with a separate name is a better option
4. Exception: a comment explaining why is allowed when a function name cannot carry it. Workarounds, spec quirks, and performance tradeoffs qualify. Comments explaining what the code does do not
5. No section comments: no `// ---- x ----` banners, no divider lines, and no plain `// x` region labels either. A region worth labeling is worth being its own function or file. In markup the fix is extraction first: a component whose name says what the region is beats any comment (`<!-- toolbar -->` over a run of html is inferior to `<VisualEditorMathToolbar />`); failing that, a semantic element (`<section>`) over a labeled `<div>`
6. If you find yourself weighing whether a comment is needed, it is not
7. Names should be general such that they can be taken out of context and understood. If a name gets too long then it is doing too many things, so consider splitting. Lint rejects names past 50 characters:

```
units.ts // What units?
meterUnits.ts // This naming assumes the exports in meterUnits.ts will explain what specifically it does about meter units, otherwise the name should be more descriptive
meterUnitsConversion.ts // Better, in this case your exports should still be descriptive about what, for instance inchesToMeters

// module state
editorState // bad, what editor? what is editor? is editor a commonly established concept?
pmEditorState // better, it is about ProseMirror, but does it apply to all ProseMirror instances? what does it hold?
currentPMEditorView // great, it holds the live EditorView, this is a good name

// functions
run(command) // run what, on what?
runCommand(command) // better, but which system's commands, and what happens after?
runCMEditorCommand(command: CMCommand) // great, executes a CodeMirror command against the CM editor

// Folders. A folder is a package: one public entry file, internals enforced private by lint,
// like Java package-private

schema.ts // bad, one super long file, and schema of what? there are several PM schemas

languages/latex/schema/ // the LaTeX ProseMirror schema, split:
  latexPMSchema.ts // the public entry, builds and exports latexPMSchema. The entry's exports carry the full name, they travel out of the folder
  pmSchemaNodes.ts // internal. Dropping the latex prefix is allowed ONLY because lint bans importing internals from outside the folder
  pmSchemaMarks.ts // internal, same rule
```

## Modules and Errors

1. Named exports only. No default exports. Exception: Svelte components, which the compiler requires to be default
2. No barrel files. Import from the real file. If a folder needs one public entry point, that is a single named file, not an index.ts re-exporting everything
3. Return a result type for expected failures. Parse failures, 404s, and invalid user input are values the caller is supposed to handle, so put them in the signature
4. Throw for bugs. Null arguments and impossible states should surface loudly, not be handled
5. Tests mirror the source tree under tests/unit. src/lib/workspace/treeOps.ts is covered by tests/unit/lib/workspace/treeOps*.test.ts
6. Runes only, no stores. Module-level reactive values go through lib/runes (box for a writable value, observe for a subscription in a non-reactive scope); a third party library that hands you a store is adapted at the same edge

## Commit Messages

Format: `type(scope): subject`

Types:

1. `feat` — new user facing capability (pre-1.0.0 these ship as `fix`, matching the changelog)
2. `fix` — corrects broken behavior
3. `refactor` — restructures code, no behavior change
4. `test` — adds or changes tests only
5. `docs` — documentation only
6. `chore` — deps, config, tooling, build

Scopes are areas of the app: editor, workspace, electron, draft, collab, chrome, filetree. Omit the scope when a change spans the codebase.

Subject:

1. Imperative mood. add pricing table, not added or adds
2. Lowercase, no trailing period
3. Under 72 characters
4. Say what changed, not which files. fix selection across split blocks, not update resolveSelection.ts

Body, blank line after the subject, only when the why is not obvious. The diff shows what, the body explains why. Same rule as comments.

Breaking changes take a `!` before the colon and a `BREAKING CHANGE:` footer describing the migration:

    feat(editor)!: replace store API with runes

    BREAKING CHANGE: consumers passing a store to createEditor must pass a rune instead


## Merging

1. Squash merge every PR. Main keeps one commit per change, with a subject that follows the rules above
2. Local commits are scratch work. Commit as often as you like while developing, the squash discards them
3. The squash commit carries the final message. Breaking change footers must live there, not in an intermediate commit that gets thrown away
