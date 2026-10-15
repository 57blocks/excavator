# source-selection-safety Specification

## Purpose

Defines the single safety boundary that decides which project inputs may enter deterministic analysis, while keeping exclusions auditable and language recognition configuration-driven.

## Requirements

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

### Requirement: Migrated language recognition uses the canonical configuration catalog

Within this change, scanner recognition for TypeScript and Dockerfile SHALL use the same built-in language configurations and matching semantics as the language registry. Exact-filename, filename-pattern, and extension matches SHALL have deterministic precedence, and duplicate scanner-only TypeScript/Dockerfile rules MUST NOT remain authoritative. Existing TypeScript `.ts`/`.tsx` recognition SHALL remain unchanged. Existing classifications whose registry ids already disagree with scanner output (`jsonc`, env/dot-env, `svg`, `mk`, OpenAPI filenames, docker-compose filenames, `rst`, and `txt`/`text`) SHALL retain their current scanner output in this change and remain explicit migration debt rather than being silently reclassified.

#### Scenario: TypeScript remains registry-consistent
- **WHEN** the scanner receives `src/app.ts` and `src/view.tsx`
- **THEN** both files are classified `typescript`, matching the default language registry

#### Scenario: Hyphenated Dockerfile variants are recognized
- **WHEN** the scanner receives `Dockerfile-prod`, `Dockerfile-qa`, and `Dockerfile-test`
- **THEN** each file is classified `dockerfile` with category `infra` through the Dockerfile language configuration

#### Scenario: Similar arbitrary name is not misclassified
- **WHEN** the scanner receives `MyDockerfile-prod`
- **THEN** the Dockerfile filename pattern does not match it

#### Scenario: Existing classification debt does not drift implicitly
- **WHEN** the pre-change classification matrix covers the known registry/scanner disagreements
- **THEN** every existing scanner result remains unchanged and only the approved Dockerfile hyphen variants are added

### Requirement: Archives remain outside the source corpus

Archive candidates matched by the default archive policy, including `*.zip`, SHALL be excluded before source materialization and SHALL NOT contribute bytes or paths to deterministic facts or source indexes.

#### Scenario: Local cebreo archive is irrelevant
- **WHEN** `unmc.zip` exists beside cebreo source directories
- **THEN** analysis selects the same source set and produces the same facts as when `unmc.zip` is absent

### Requirement: Project-specific selection judgment remains agent-owned

Project-specific generated-directory discovery, rule proposal, and source-loss review SHALL be performed by the host skill from existing deterministic scan evidence and persisted only as project-owned root `.excavatorignore` rules. The deterministic runtime SHALL provide generic selection and accounting primitives but MUST NOT contain cebreo-, MAUI-, or other project-specific ignore profiles when the host agent can derive those rules reliably.

The host skill SHALL run this lightweight review before choosing Lazy or Full whenever the root file is absent or legacy rules require migration. It SHALL use project layout, `.gitignore`, and scan bucket evidence to discover candidates rather than treating its example names as a closed registry. It SHALL use host-native temporary-file operations on Windows and POSIX, and SHALL pass newly approved rules to the current run when Git HEAD cannot yet contain the edited root file.

#### Scenario: cebreo rules come from evidence, not a product branch
- **WHEN** cebreo contains generated directories with project-specific names
- **THEN** the host skill proposes and verifies root ignore rules from scanner evidence without adding a cebreo or MAUI conditional to product code

#### Scenario: Generic safety remains deterministic
- **WHEN** a candidate matches a non-negatable secret, archive, or analysis-data safety rule
- **THEN** deterministic code rejects it before model access without relying on prompt compliance

#### Scenario: Lazy first run receives project rules without Full analysis
- **WHEN** the root `.excavatorignore` is absent and the resolved mode is Lazy
- **THEN** the host completes the lightweight before/after review first and the Lazy run receives every approved rule

### Requirement: 默认的文件规则不排除目录

默认忽略规则里不以 `/` 结尾的规则是文件规则，例如 `LICENSE`、`*.lock`、`*.log`、`*.map`、`.eslintrc*`。

文件规则 SHALL 只排除名字与之匹配的文件，匹配照旧不区分大小写，在任何深度生效。

文件规则 MUST NOT 排除同名目录，也 MUST NOT 排除这类目录下的文件。目录下的文件按其余规则正常判定：匹配某条文件规则的文件仍被排除，位于被目录规则排除的目录之下的文件仍被排除。

项目根 `.excavatorignore` 与 CLI 规则排在默认规则之后，SHALL 仍能排除这类目录，也仍能用取反规则重新纳入被文件规则排除的文件。

这一要求对默认规则里的每条文件规则都成立，包括以后新增的，不靠逐条列举。git、目录与多仓库三种来源的选择结果 SHALL 一致。

#### Scenario: 名为 license 的源码目录被选中
- **WHEN** 仓库含 `src/main/java/org/example/license/LicenseService.java`、`app/Services/License/LicenseService.php` 与 `src/Services/License/ILicenseProvider.cs`，且没有项目规则
- **THEN** 三个文件都被选中，进入扫描、结构抽取与事实图

#### Scenario: 许可证文件照旧排除
- **WHEN** 仓库含 `LICENSE`、`docs/LICENSE`、`docs/legal/license`（无扩展名的文件）与 `src/main/java/org/example/license/LICENSE`
- **THEN** 四个文件都是 `filtered-by-defaults`，原因是默认规则；`LICENSE.md` 与 `License.txt` 的判定与改前相同

#### Scenario: 每条文件规则都放过同名目录
- **WHEN** 对默认规则里的每条文件规则，构造一个名字与之匹配的目录，目录下放一个 `Foo.java`
- **THEN** `Foo.java` 被选中；同名的文件仍是 `filtered-by-defaults`

#### Scenario: 目录规则不变
- **WHEN** 仓库含 `node_modules/license/index.js` 与 `build/license/Gen.java`
- **THEN** 两个文件仍被默认规则排除，因为它们的上级目录被目录规则排除

#### Scenario: 项目规则仍能排除该目录
- **WHEN** 项目根 `.excavatorignore` 写 `license/`，仓库含 `src/license/A.java`
- **THEN** `src/license/A.java` 是 `filtered-by-ignore`，原因是项目规则

#### Scenario: 三种来源一致
- **WHEN** 同一份含 `license/` 源码目录与 `LICENSE` 文件的内容，分别经 git 提交快照、目录快照与多仓库快照呈现
- **THEN** 三者选中的路径集合与选择摘要相同
