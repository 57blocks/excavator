## Purpose

Defines the single safety boundary that decides which project inputs may enter deterministic analysis, while keeping exclusions auditable and language recognition configuration-driven.

## ADDED Requirements

### Requirement: One selection boundary precedes every source consumer

The system SHALL apply the same deterministic selection policy before a candidate file can be materialized for analysis or handed to scanning, extraction, import resolution, source indexing, search, or model context. Git, directory, and multi-repository source adapters SHALL expose the same selected path set for identical content and selection rules. No downstream consumer SHALL implement a broader fallback selection path.

#### Scenario: Adapters select the same inputs
- **WHEN** identical fixture content and ignore rules are presented through GitCommitSnapshot, DirectorySnapshot, and MultiRepoSnapshot
- **THEN** all three adapters expose the same selected paths and the same selection digest

#### Scenario: Downstream consumers cannot recover an excluded file
- **WHEN** a candidate is rejected by the selection boundary
- **THEN** its bytes are absent from scan output, deterministic facts, source indexes, search results, and model-readable context

### Requirement: Sensitive inputs are hard-excluded

The selection boundary SHALL classify credential-bearing extensions (including `.pem`, `.key`, `.ks`, `.jks`, `.pfx`, `.p12`, and `.set`) and files containing a recognized private-key header as `sensitive`. A root `.excavatorignore` negation or CLI exclusion negation MUST NOT re-include them. For a sensitive candidate the system MAY retain normalized relative path, byte size, and reason code, but MUST NOT persist or emit content, content excerpts, or a content hash.

#### Scenario: Extension-based secret never crosses the boundary
- **WHEN** a fixture contains `config/privatekey3072.key` and user rules contain `!config/privatekey3072.key`
- **THEN** the file is classified `sensitive`, no bytes or content hash appear in analysis artifacts, and the override is rejected

#### Scenario: Header-based secret with an unknown extension is contained
- **WHEN** a text file with an otherwise selectable extension begins with a recognized private-key header
- **THEN** it is classified `sensitive` before any downstream consumer receives its bytes

#### Scenario: Non-secret control remains selectable
- **WHEN** a same-sized text fixture lacks a protected extension and private-key header
- **THEN** it proceeds through ordinary selection, proving the detector does not reject every text file

### Requirement: Language recognition uses the canonical configuration catalog

Scanner language recognition SHALL use the same built-in language configurations and matching semantics as the language registry. Extension, exact-filename, and filename-pattern matches SHALL have deterministic precedence, and duplicate scanner-only language tables MUST NOT be authoritative. Existing TypeScript `.ts`/`.tsx` recognition SHALL remain unchanged.

#### Scenario: TypeScript remains registry-consistent
- **WHEN** the scanner receives `src/app.ts` and `src/view.tsx`
- **THEN** both files are classified `typescript`, matching the default language registry

#### Scenario: Hyphenated Dockerfile variants are recognized
- **WHEN** the scanner receives `Dockerfile-prod`, `Dockerfile-qa`, and `Dockerfile-test`
- **THEN** each file is classified `dockerfile` with category `infra` through the Dockerfile language configuration

#### Scenario: Similar arbitrary name is not misclassified
- **WHEN** the scanner receives `MyDockerfile-prod`
- **THEN** the Dockerfile filename pattern does not match it

### Requirement: Archives remain outside the source corpus

Archive candidates matched by the default archive policy, including `*.zip`, SHALL be excluded before source materialization and SHALL NOT contribute bytes or paths to deterministic facts or source indexes.

#### Scenario: Local cebreo archive is irrelevant
- **WHEN** `unmc.zip` exists beside cebreo source directories
- **THEN** analysis selects the same source set and produces the same facts as when `unmc.zip` is absent
