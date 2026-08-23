# TODO

Current focus: refactor first (styles.md tooling adoption, then code structure cleanup). Features below wait behind it.

1. Draft mode: remove the JS approximations of TeX. Placement decisions come from the engine (glue export from the shipout box, \vsplit for column and page breaks, engine-reported column origins); the provisional tint remains only where the decision is irreducibly global, such as counters, floats, and cross-page cascades
2. Support editing .bbl files
