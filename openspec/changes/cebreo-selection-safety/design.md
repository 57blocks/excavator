## Context

See `proposal.md` — Why. Selection is currently split between `createIgnoreFilter`, three SourceSnapshot adapters, and `scan-project.mjs`. DirectorySnapshot hashes selected bytes before scan, GitCommitSnapshot archives the whole tree and prunes afterward, and direct scan repeats its own filtering and language tables. The starter generator writes `.excavator/.excavatorignore` while GitCommitSnapshot reads only root `.excavatorignore`; identical rules can therefore produce different snapshots. The current Dockerfile special case accepts `Dockerfile` and `Dockerfile.*`, but not the hyphenated variants present in cebreo.

The archived MAUI change already proved that globally ignoring `bin/` is unsafe (`bin/rails` is source) and that cebreo's `.unit-test/` name is project-specific. SourceSnapshot and revision-sync are already on `main`; this change must strengthen their selection boundary rather than add a parallel scanner-only fix.

## Goals / Non-Goals

**Goals:**

- Make selection one deterministic, explainable contract shared by snapshots and direct scans.
- Ensure a protected file is never copied to a temporary analysis tree, hashed into a manifest, indexed, or exposed to a downstream reader.
- Preserve registry-driven extension detection for TypeScript while adding declarative basename-pattern detection for Dockerfiles.
- Keep every exclusion visible without persisting secret content.

**Non-Goals:**

- Framework discovery across nested manifests; the next change will extend the existing `FrameworkConfig`/`FrameworkRegistry` path used by Express.
- C# owner/import or XAML binding resolution, and HTML/XML/Gradle readers.
- Automatic acceptance of guessed cebreo ignore rules. The system proposes the project recipe; the user-owned root file remains authoritative.
- Scanning `unmc.zip`; archive exclusion is an invariant, not a fixture dependency.

## Decisions

### D1. Introduce one pure selection policy and make adapters authoritative

Add a core selection policy whose input is normalized relative path, effective rule sources, stat metadata, and at most a bounded content prefix. Its output is one tagged decision: `selected`, `filtered-by-defaults`, `filtered-by-ignore`, `sensitive`, or a named read/type failure. The policy version and ordered rule descriptors feed `selectionDigest`.

SourceSnapshot adapters will call the policy while enumerating candidates and expose both selected paths and a safe selection ledger. Direct `scan-project.mjs` will use the same policy for standalone invocation. When Lazy analyzes a materialized snapshot, it will merge the adapter ledger with scan/extraction outcomes instead of re-enumerating excluded source.

Alternative considered: patch only `scan-project.mjs`. Rejected because Git snapshots currently materialize excluded bytes before the scanner runs, while source index/search operate from snapshot paths; a scanner-only patch cannot establish the security boundary or adapter parity.

### D2. Split hard safety rules from ordinary ignore precedence

Ordinary defaults, root `.excavatorignore`, and CLI rules retain their existing ordered `ignore` semantics, including allowed negation such as `!LICENSE`. A separate hard-safety predicate runs before and after ordinary matching and cannot be negated. It covers `.excavator/` variants, archive defaults, sensitive extensions, and recognized private-key headers.

Path-detectable sensitive files are rejected without a content read. For an otherwise selectable text file, the policy reads only a bounded prefix to recognize standard private-key headers; the buffer is discarded immediately and never hashed or included in output. The ledger contains normalized relative path, size when known, and reason code only.

Alternative considered: rely on `.gitignore`/`.excavatorignore`. Rejected because user negation can restore a secret, Git and non-Git snapshots read different rule sources today, and safety must not depend on a project remembering a pattern.

### D3. Materialize only selected paths

DirectorySnapshot will hash and copy only `selected` candidates. GitCommitSnapshot will stop archiving the whole tree: it will enumerate the fixed tree, select each candidate at the fixed SHA, and write only selected files to the temporary tree. MultiRepoSnapshot will compose its parent/member ledgers and ordered selection digests, prefixing member paths exactly once. Search, `readFile`, `entries`, and `diff` remain constrained to the selected set.

This makes secret exclusion structural: no downstream code can reopen a rejected path because it is absent from `listFiles()` and the materialized tree. Directory consistency checks remain based on the selected manifest; changes to excluded secrets do not invalidate source facts, while selection-policy changes invalidate through `selectionDigest`.

Alternative considered: archive then delete. Rejected because the protected bytes already crossed the materialization boundary and briefly existed in a temp tree.

### D4. Root `.excavatorignore` becomes the only project rule source

`generate-ignore.mjs` will write `<project>/.excavatorignore`; `createIgnoreFilter`, all SourceSnapshot adapters, incremental preparation, and direct scan will read only that file. The file inside `.excavator/` is no longer consulted. Git snapshots continue to read the root file from the fixed commit, while directory snapshots read it from disk.

This is intentionally breaking and follows the existing main spec. No automatic migration or fallback is added: users copy reviewed patterns once to the root file. One authoritative location is required for deterministic HEAD-only Git analysis.

Alternative considered: keep both locations and define precedence. Rejected because the data-directory file cannot be represented in a GitCommitSnapshot's HEAD source, so parity is impossible.

### D5. Language and framework support stays declarative

Extend `LanguageConfig` with optional basename patterns and give `LanguageRegistry` a single deterministic matcher with precedence: exact filename, basename pattern, then extension. The Dockerfile config declares `Dockerfile.*` and `Dockerfile-*`; TypeScript keeps its existing `.ts`/`.tsx` config. `scan-project.mjs` queries this matcher for registered languages and retains an explicit fallback only for genuinely unregistered extensions until those configs are added; it does not add a cebreo or hyphen-specific branch. Category assignment treats canonical `dockerfile` language as `infra`.

The same convention applies to later changes: framework support must be a `FrameworkConfig` registered in `builtinFrameworkConfigs` and detected by `FrameworkRegistry`, as Express is today. This change does not alter framework detection.

Alternative considered: add `base.startsWith('Dockerfile-')` beside the existing scanner special case. Rejected because it widens the duplicate table and would not be visible to other LanguageRegistry consumers.

### D6. The oracle is frozen before implementation

The first implementation commit contains failing synthetic acceptance fixtures only:

1. A fake private key with a unique canary plus a same-sized non-secret control proves the detector sees the prohibited case without rejecting all text.
2. A fixture with `bin/rails` and a MAUI generated-tree fixture proves the project recipe removes only intended noise and global defaults keep real source.
3. Git, directory, and multi-repo copies of identical content prove selected paths and digests agree; a deliberate adapter-bypass control must make the test fail.
4. TypeScript files and Dockerfile dot/hyphen variants prove registry parity; `MyDockerfile-prod` is the negative identity fixture.
5. A present/absent `unmc.zip` pair proves archives cannot affect selected paths or facts.

No implementation task may weaken these assertions. The acceptor reviews the frozen oracle and final diff independently from the coder.

## Risks / Trade-offs

- **[Risk] Root ignore migration surprises users of the generated data-directory file.** → Print one actionable error/warning naming the old and new paths; document the one-time copy; add no fallback.
- **[Risk] Header sniffing reads some protected bytes inside the policy.** → Bound the read, never stringify/log/hash it, discard immediately, and test with a canary search over artifacts and output.
- **[Risk] Per-file `git show` is slower than one `git archive`.** → Reject by path before reads, batch only selected paths if measurement warrants it, and record a regression budget in tests; correctness and containment take priority.
- **[Risk] Canonical registry migration changes classifications unintentionally.** → Snapshot the current declared-language matrix first and require zero differences except approved Dockerfile hyphen variants.
- **[Risk] Project ignore recipes can still hide real source.** → Keep suggestions commented until accepted and require the no-source-loss comparison before cebreo use.

## Migration Plan

1. Land the failing synthetic oracle and accepted classification baseline.
2. Land the core selection policy and language matcher.
3. Move snapshot adapters and direct scan to the shared policy; remove whole-tree Git materialization.
4. Switch ignore generation/consumption to root `.excavatorignore`, update skill instructions, and remove the data-directory reader/tests.
5. Add the reviewed cebreo/MAUI recipe as guidance and run synthetic gates; real cebreo end-to-end metrics remain the final ordered acceptance change.

Rollback is by logical commit in reverse order. A rollback must restore the prior tests and contract together; it MUST NOT keep a test that claims sensitive containment while restoring whole-tree materialization.
