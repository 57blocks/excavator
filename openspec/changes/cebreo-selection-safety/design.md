## Context

See `proposal.md` — Why. Selection is currently split between `createIgnoreFilter`, three SourceSnapshot adapters, and `scan-project.mjs`. DirectorySnapshot hashes selected bytes before scan, GitCommitSnapshot archives the whole tree and prunes afterward, and direct scan repeats its own filtering and language tables. The starter generator writes `.excavator/.excavatorignore` while GitCommitSnapshot reads only root `.excavatorignore`; identical rules can therefore produce different snapshots. The current Dockerfile special case accepts `Dockerfile` and `Dockerfile.*`, but not the hyphenated variants present in cebreo.

The archived MAUI change already proved that globally ignoring `bin/` is unsafe (`bin/rails` is source) and that cebreo's `.unit-test/` name is project-specific. SourceSnapshot and revision-sync are already on `main`; this change must strengthen their selection boundary rather than add a parallel scanner-only fix.

## Goals / Non-Goals

**Goals:**

- Make selection one deterministic, explainable contract shared by snapshots and direct scans.
- Ensure a protected file is never copied to a temporary analysis tree, hashed into a manifest, indexed, or exposed to a downstream reader.
- Preserve registry-driven extension detection for TypeScript while adding declarative basename-pattern detection for Dockerfiles.
- Keep every exclusion visible without persisting secret content.
- Keep project judgment in the host skill and minimize permanent product code.

**Non-Goals:**

- Framework discovery across nested manifests; the next change will extend the existing `FrameworkConfig`/`FrameworkRegistry` path used by Express.
- C# owner/import or XAML binding resolution, and HTML/XML/Gradle readers.
- Automatic acceptance of guessed cebreo ignore rules. The host skill proposes and reviews the project recipe; the user-owned root file remains authoritative.
- A MAUI/cebreo ignore registry, generated-directory classifier, dedicated ignore validator, or other code whose result the host agent can derive from existing scan evidence.
- Scanning `unmc.zip`; archive exclusion is an invariant, not a fixture dependency.

## Decisions

### D0. Every implementation item must pass the AI-first scope gate

Before adding code, the coder must show that at least one of these is true:

1. the decision must happen before model access to enforce a security or permission boundary;
2. independent consumers need the same deterministic, machine-verifiable result;
3. the result participates in identity, freshness, persistence, or coverage conservation; or
4. the workload cannot be completed reliably by the host agent within acceptable context, latency, or cost.

If none applies, the behavior belongs in the Excavator skill/prompt. Under this test, sensitive-file containment, SourceSnapshot path selection, selection digests/ledgers, and canonical language matching require code. Discovering cebreo's generated directories, proposing a root ignore file, comparing two scan manifests, and explaining why dropped files are safe belong in the host skill.

Alternative considered: encode every observed cebreo convention as a config or validator. Rejected because the host agent already has filesystem inspection, existing deterministic scanner output, and project context; permanent code would harden one corpus's naming into product policy.

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

The Excavator skill will inspect the project and write `<project>/.excavatorignore` directly through the host's normal file-editing capability. `createIgnoreFilter`, all SourceSnapshot adapters, incremental preparation, and direct scan will read only that file. The file inside `.excavator/` is no longer consulted. Git snapshots continue to read the root file from the fixed commit, while directory snapshots read it from disk.

Do not add generator logic for MAUI/cebreo or a new validator. Remove the skill's dependency on the current data-directory generator; if its content generator has no remaining production consumer, delete the dead helper/export/tests instead of preserving compatibility. The skill checks for the old data-directory file, explains the one-time move, reviews the proposed rules, runs the existing scanner twice, and writes the root file only after the no-source-loss comparison.

This is intentionally breaking and follows the existing main spec. No automatic code migration or fallback is added. One authoritative location is required for deterministic HEAD-only Git analysis.

Alternative considered: keep both locations and define precedence. Rejected because the data-directory file cannot be represented in a GitCommitSnapshot's HEAD source, so parity is impossible.

### D5. TypeScript and Dockerfile matching moves to the declarative catalog

Extend `LanguageConfig` with optional basename patterns and give `LanguageRegistry` a single deterministic matcher with precedence: exact filename, basename pattern, then extension. The Dockerfile config declares `Dockerfile.*` and `Dockerfile-*`; TypeScript keeps its existing `.ts`/`.tsx` config. `scan-project.mjs` uses this matcher as the authority for TypeScript and Dockerfile and removes its duplicate rules for those two languages; it does not add a cebreo or hyphen-specific branch. Category assignment treats canonical `dockerfile` language as `infra`.

Live-main inspection found pre-existing registry/scanner disagreements for `jsonc`, env/dot-env, `svg`, `mk`, OpenAPI filenames, docker-compose filenames, `rst`, and `txt`/`text`. Migrating all registered languages now would silently change eight established scanner contracts, contradicting this change's zero-unapproved-drift oracle. Those classifications therefore remain on the existing scanner compatibility path and are recorded as explicit migration debt for a dedicated catalog-unification change. This is a scoped exception, not permission to add new duplicate rules.

The same convention applies to later changes: framework support must be a `FrameworkConfig` registered in `builtinFrameworkConfigs` and detected by `FrameworkRegistry`, as Express is today. This change does not alter framework detection.

Alternative considered: add `base.startsWith('Dockerfile-')` beside the existing scanner special case. Rejected because it widens the duplicate table and would not be visible to other LanguageRegistry consumers.

### D6. The oracle is frozen before implementation

The first implementation commit contains failing synthetic acceptance fixtures only:

1. A fake private key with a unique canary plus a same-sized non-secret control proves the detector sees the prohibited case without rejecting all text.
2. A fixture with `bin/rails` proves global defaults keep real source; project-specific MAUI/cebreo recipe review remains a skill acceptance exercise over two ordinary scan manifests, not a new product validator.
3. Git, directory, and multi-repo copies of identical content prove selected paths and digests agree; a deliberate adapter-bypass control must make the test fail.
4. TypeScript files and Dockerfile dot/hyphen variants prove registry parity; `MyDockerfile-prod` is the negative identity fixture.
5. A present/absent `unmc.zip` pair proves archives cannot affect selected paths or facts.

No implementation task may weaken these assertions. The acceptor reviews the frozen oracle and final diff independently from the coder, and rejects any product module that fails D0 even when its tests pass.

### D7. Later cebreo changes repeat the same scope gate

Nested manifest enumeration and framework identity require deterministic code only where multiple consumers need the same result; framework interpretation remains prompt guidance using the existing `FrameworkConfig`/`FrameworkRegistry` pattern exemplified by Express. C#/XAML facts enter code only for stable identities, owners, imports, bindings, and evidence anchors. The proposed non-code-reader change begins with a skill-only experiment: if existing read/search plus prompting answers the target questions with evidence at acceptable cost, that code change is skipped. Final real-corpus acceptance is a skill workflow over deterministic outputs, not a cebreo-specific runtime feature.

## Risks / Trade-offs

- **[Risk] Root ignore migration surprises users of the generated data-directory file.** → The skill checks both paths before analysis, names the old and new paths, and guides the one-time copy; runtime adds no fallback.
- **[Risk] Header sniffing reads some protected bytes inside the policy.** → Bound the read, never stringify/log/hash it, discard immediately, and test with a canary search over artifacts and output.
- **[Risk] Per-file `git show` is slower than one `git archive`.** → Reject by path before reads, batch only selected paths if measurement warrants it, and record a regression budget in tests; correctness and containment take priority.
- **[Risk] Canonical registry migration changes classifications unintentionally.** → Scope this change to TypeScript/Dockerfile, snapshot the full current classification matrix, and require zero differences except approved Dockerfile hyphen variants; migrate the eight known disagreements only under a later explicit contract change.
- **[Risk] Project ignore recipes can still hide real source.** → The skill shows proposed rules, runs the existing scanner before/after, and reviews every dropped source extension before writing the root file.

## Migration Plan

1. Land the failing synthetic oracle and accepted classification baseline.
2. Land the core selection policy and the scoped TypeScript/Dockerfile language matcher.
3. Move snapshot adapters and direct scan to the shared policy; remove whole-tree Git materialization.
4. Switch ignore consumption to root `.excavatorignore`, remove the data-directory reader, and move project-rule discovery/writing/comparison into the skill; delete the old generator path if it has no remaining consumer.
5. Use the skill to review the cebreo/MAUI recipe from two existing scans; real cebreo end-to-end metrics remain the final ordered acceptance change.

Rollback is by logical commit in reverse order. A rollback must restore the prior tests and contract together; it MUST NOT keep a test that claims sensitive containment while restoring whole-tree materialization.
