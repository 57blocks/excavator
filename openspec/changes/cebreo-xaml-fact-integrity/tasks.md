## 1. Freeze and prove the acceptance oracle

- [ ] 1.1 Add invented positive and known-false XAML fixtures for comments, scoped types, explicit sources, original line numbers, and determinism; verify the existing reader sees the positive control and fails at least one known-false assertion before parser edits.

## 2. Repair the single-file reader

- [ ] 2.1 Exclude XML comments and non-element content from tag/attribute extraction while preserving source offsets; verify focused tests show zero comment-derived sections/definitions and unchanged live line anchors.
- [ ] 2.2 Apply nearest-element `x:DataType` inheritance, template override/restoration, and explicit `Source`/`RelativeSource` uncertainty; verify the frozen context matrix passes and no member edge is emitted.

## 3. Validate consumers and the real corpus

- [ ] 3.1 Add a synthetic extraction-to-fact-graph regression; verify a live concept survives while the commented concept creates no graph node even when there are zero gaps.
- [ ] 3.2 Run read-only checks against the cebreo cases that exposed comments, nested template type, and an ordinary typed page; verify no false comment facts, correct local contexts, and separately record any remaining omissions without committing source, paths, or output.
- [ ] 3.3 Run `pnpm install --frozen-lockfile`, `pnpm -r build`, and `pnpm test`; verify all exit successfully and record failures by location, cause, and fix.
- [ ] 3.4 Run `openspec validate cebreo-xaml-fact-integrity --strict` and review the branch diff; verify no unrelated reader/resolver changes or real-project artifacts enter the change, then commit logical steps for review.
