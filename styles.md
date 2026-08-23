# Code Style Guide
 
## Naming Conventions
  
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
 
1. More files with less LOC > 1 file with more LOC. If a component can be separated into sub components then it should always be separated into sub components
2. Exception: super short components, components under 250 LOC, or large files with easy to understand intentions such as a list of words or a super long map
3. When a file is split, break it into a folder named after the component. EditorToolbar/ holds EditorToolbar.svelte, EditorToolbar.types.ts, editorToolbarState.svelte.ts
4. Type definitions go into a type file, exception for super short files
5. UI goes into .svelte, pure logic stays in .ts or .svelte.ts. NEVER put more ts logic than needed to drive the UI in .svelte
6. Use .svelte.ts only when the file needs Svelte to process it, for instance when using runes. Plain .ts otherwise

## Code Structure
 
1. Declare constants at the very top of the file only, and in CAPS
2. Use functions instead of () => if possible. Exception: inline callbacks and anything passed directly as an argument
3. Immutable design as much as possible. Mutable creates unnecessary races
4. Return new values instead of editing arguments. No function should modify what it was given

## Naming and Comments
 
1. File and folder names should be expressive enough that each file requires 0 top of the file comments. Top of the file comments should be avoided as much as possible
2. Function names should be descriptive. Do not use simple names like load, load what? Variable names should be just as clear
3. Comments should be avoided as much as possible. In most cases, if you need a comment, making that part of the code a separate function with a separate name is a better option
4. Exception: a comment explaining why is allowed when a function name cannot carry it. Workarounds, spec quirks, and performance tradeoffs qualify. Comments explaining what the code does do not

## Modules and Errors
 
1. Named exports only. No default exports. Exception: Svelte components, which the compiler requires to be default
2. No barrel files. Import from the real file. If a folder needs one public entry point, that is a single named file, not an index.ts re-exporting everything
3. Return a result type for expected failures. Parse failures, 404s, and invalid user input are values the caller is supposed to handle, so put them in the signature
4. Throw for bugs. Null arguments and impossible states should surface loudly, not be handled
5. Tests are colocated. resolveSelection.ts sits beside resolveSelection.test.ts
6. Runes only, no stores. Exception: a third party library that hands you a store, adapted at the edge

## Commit Messages
 
Format: `type(scope): subject`
 
Types:
 
1. `feat` — new user facing capability
2. `fix` — corrects broken behavior
3. `refactor` — restructures code, no behavior change
4. `test` — adds or changes tests only
5. `docs` — documentation only
6. `chore` — deps, config, tooling, build
Scopes are areas of the app: landing, editor, auth. Omit the scope when a change spans the codebase.
 
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
