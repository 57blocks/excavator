## 1. Freeze the language oracle

- [x] 1.1 Acceptor (Opus) writes the pre-implementation oracle for English model prose, Chinese-contaminated prose, source-owned non-English identifiers, old language metadata, and request-language selection; verify every inspected field lands in an accepted/rejected bucket and no pass condition trusts `contentLanguage` alone.
- [x] 1.2 Coder (Sonnet) adds the fake writer/freshness fixtures and verifies the current implementation fails for the expected mixed-language, missing-marker, or persisted-language-authority reason before any production edit.

## 2. Enforce one persisted language

- [x] 2.1 Coder upgrades semantic-cache metadata and writer prompts to deterministic `contentLanguage=en`; verify English entries are accepted, noncanonical entries report `noncanonical-language`, the first canonical write does not carry forward any old unverified entry, source-owned fields remain unchanged, and `knowledge-graph.json` is never written.
- [x] 2.2 Coder stamps semantic graph and domain graph with `contentLanguage=en` and includes it in freshness; verify missing/non-English markers invalidate only the corresponding semantic product and leave the fact graph byte-identical.
- [x] 2.3 Coder implements the model-owned-field language audit; only exact source-owned spans supplied by the current fact graph or SourceSnapshot may be masked, never model-declared exemptions; verify the frozen English/Chinese/source-owned fixtures produce their expected visible terminal buckets.
- [x] 2.4 Coder removes `/excavator` analyzer `--language`, `$LANGUAGE_DIRECTIVE`/locale injection, and `outputLanguage` config authority; decouple `excavator-figma` from the removed directive while preserving its independent language behavior; verify help rejects the old `/excavator` option clearly, config normalization removes only the old field, Figma has no dangling variable reference, and every `.excavator` semantic-generation prompt requests English.
- [x] 2.5 Coder updates Chat to preserve the original question, add English retrieval expressions, and choose answer language after source verification; verify Chinese, English, explicit-Japanese, and identifier-only fixtures return the required language without changing config or semantic storage language.
- [ ] 2.6 Acceptor independently reviews the implementation against `canonical-semantic-language/spec.md`; verify the red fixtures are green, original evidence is preserved, old summaries are regenerated rather than translated, and no cache-reuse behavior from the next change was silently bundled.

## 3. Validate on Conduit and close the change

- [ ] 3.1 Run all focused semantic-cache/graph/domain/config/language/Chat tests; verify they exit 0 and assert actual prose language, source-field exemptions, visible invalidation reasons, and fact-graph immutability.
- [ ] 3.2 On pinned Conduit commit `5e127d8569b300e0a21dc2c20ea680da4967b1aa`, ask “收藏文章是怎么实现的” and then an English overlapping question; verify persisted model prose is English, answers follow each request, identifiers remain verbatim, and no test source or `.excavator` output enters the Excavator diff.
- [ ] 3.3 Run `pnpm install --frozen-lockfile`, `pnpm -r build`, and `pnpm test`; verify all commands exit 0 without skipped or weakened suites.
- [ ] 3.4 Run `openspec validate --strict canonical-semantic-language` and `git diff --check`; verify both exit 0 and the diff contains no unrelated user edits or real-project generated data.
