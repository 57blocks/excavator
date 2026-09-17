## Why

cebreo currently reaches extraction with generated coverage/build trees and credential-like files mixed into its source set, while alternate Dockerfile names are skipped as unknown. This makes coverage noisy and risks exposing secret material before later C#/XAML and framework improvements can be evaluated safely.

## What Changes

- Apply an AI-first scope gate: project-specific judgment, orchestration, explanation, and adaptation that the host agent can perform reliably SHALL live in the Excavator skill/prompt, not product code. Code is reserved for pre-model safety boundaries, deterministic reusable facts, machine-verifiable invariants, persistence contracts, and work that cannot be completed reliably within agent cost/scale limits.
- Add one deterministic pre-extraction selection boundary that classifies every candidate before bytes can reach scanning, extraction, indexing, search, or model context.
- **BREAKING** Make root `.excavatorignore` the only project ignore source; stop reading the conflicting `.excavator/.excavatorignore` location so snapshot adapters and direct scans cannot select different files.
- Run the agent-owned ignore preflight before the Lazy/Full branch when the root file is missing or the obsolete data-directory file still exists. The preflight uses the existing scanner only, writes the root file after before/after review, and does not require a Full analysis or restore a rule generator.
- Expand conservative universal defaults with cross-platform operating-system metadata and unambiguous tool caches: macOS Finder/AppleDouble/archive metadata, Windows Explorer/recycle/system-volume metadata, and `.vs/`/`.gradle/`. Let the Excavator skill inspect cebreo and propose remaining project-specific `bin/`, `.unit-test/`, `TestResults/`, `.scratch/`, or package-cache rules from evidence. Do not add a MAUI/cebreo rule registry, generator, or dedicated validator.
- Add a non-negatable sensitive-file policy for credential/container extensions and recognized private-key material. Record only safe metadata in a visible `sensitive` skip bucket; never persist or return the file bytes.
- Recognize canonical Dockerfile variants such as `Dockerfile-prod`, `Dockerfile-qa`, and `Dockerfile-test` through the same `LanguageConfig`/`LanguageRegistry` path used by TypeScript and other languages, instead of adding a cebreo-only scanner branch.
- Reconcile the MAUI specification with the already-decided project-level ignore boundary: `bin/` and `.unit-test/` are not global defaults because they can contain source in other ecosystems.
- Keep `unmc.zip` out of scope as an input corpus artifact; existing `*.zip` exclusion remains the required behavior even after the local file is deleted.

## Capabilities

### New Capabilities

- `source-selection-safety`: Defines the single pre-extraction selection boundary, secret containment, and config-driven filename recognition.

### Modified Capabilities

- `data-directory`: Defines project-level ignore precedence, non-negatable safety exclusions, and selection-digest participation.
- `coverage-ledger`: Adds an explicit `sensitive` skip reason and conservation rules without exposing protected bytes.
- `maui-framework`: Replaces the incorrect global `bin/`/`.unit-test/` requirement with a validated project-level ignore recipe.

## Impact

- Product-code impact is limited to the pre-model selection boundary, conservative cross-platform defaults, root ignore consumption, SourceSnapshot selection, coverage schemas, canonical language matching, and their tests. Project-specific rule discovery and review affect only the Excavator skill/prompt.
- Extends existing configuration/registry types rather than adding language- or framework-specific dispatch in the scanner.
- Adds no runtime dependency and no legacy compatibility path.
- Does not implement nested multi-project framework discovery, C#/XAML resolution, or HTML/XML/Gradle readers. Each later change must pass the same AI-first scope gate; in particular, non-code readers are skipped if existing read/search plus skill prompting can answer the required questions with evidence.
