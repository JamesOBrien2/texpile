# texpile-typst-syntax-wasm

Typst's official parser, compiled to WebAssembly and exposed to JavaScript as a Lezer syntax tree.

CodeMirror needs a `Parser` that produces a Lezer `Tree`. Typst has no Lezer grammar, and writing
one would be a second implementation of a language whose parser _is_ its specification — it would
drift from the compiler every release, and the failure mode is silent (the editor accepting syntax
that `typst compile` rejects). Compiling the real parser instead makes disagreement impossible.

## What this is not

[`codemirror-lang-typst`](https://github.com/kxxt/codemirror-lang-typst) (Apache-2.0) got here
first and is the reason this approach was chosen at all. This crate differs in two ways that
mattered enough to justify our own:

- **No fork of Typst.** That package carries a patched Typst repo as a submodule, because it wanted
  fine-grained edit deltas out of the reparser and that needed changes to `node.rs`, `reparser.rs`
  and `lib.rs`. Rebuilding a flat buffer per parse is a cheap tree walk that needs none of it, so
  this depends on the published `typst-syntax` crate and tracks Typst releases by version bump.
- **Immutable trees.** That package reinterprets the wasm's output object as a Lezer `Tree` by
  prototype reassignment, then mutates it in place on every edit. Lezer trees are meant to be
  immutable and shared between editor states — mutating one means an older state describes a
  document it no longer matches. This crate emits Lezer's documented `Tree.build` buffer instead,
  so every parse yields a fresh, immutable tree.

Attribution for the idea and for the `styleTags` mapping our JS side reuses belongs to that
project, under Apache-2.0.

## Wire format

`buffer()` returns one flat `Uint32Array`, four values per node — `[typeId, from, to, size]` — with
children before their parents, exactly as `Tree.build` documents. `from`/`to` are UTF-16 code units
(CodeMirror's unit), converted during the walk rather than after, which keeps it linear.

Node type ids are assigned by this crate and published by `node_names()` in id order, rather than
being `SyntaxKind`'s discriminants — those shift whenever Typst adds a kind, and a table built from
the binary in hand cannot go stale against it.

## Building

Requires a Rust toolchain and `wasm-pack`:

```bash
cargo install wasm-pack
pnpm --filter texpile-typst-syntax-wasm build
```

The built `pkg/` is committed, so a normal `pnpm install` needs no Rust. Rebuild it when bumping
the `typst-syntax` dependency, and note the version in the commit message — the parser version and
the version tinymist compiles with should not drift far apart.

## Licence

Apache-2.0, matching Typst and the project this takes after. Texpile itself is AGPL-3.0, which
Apache-2.0 code may be included in.
