## MODIFIED Requirements

### Requirement: 构建与覆盖产物移出扫描分母

MAUI repositories with project-specific generated trees SHALL express `bin/`, `.unit-test/`, `TestResults/`, `.vs/`, `.gradle/`, and `.scratch/` exclusions in the authoritative root `.excavatorignore`. The global defaults SHALL continue to exclude universally generated outputs such as `obj/`, `coverage/`, binary extensions, and archives, but MUST NOT globally exclude `bin/` or `.unit-test/`. Before the project recipe is accepted, a deterministic comparison SHALL prove that the additional rules remove no `.cs`, `.xaml`, `.csproj`, or `.feature` source.

#### Scenario: 去污只降噪不误伤
- **WHEN** a MAUI fixture is scanned with and without the project recipe
- **THEN** every removed file belongs to the named generated trees and zero `.cs`, `.xaml`, `.csproj`, or `.feature` files are removed

#### Scenario: 其他生态的 bin 源码仍被保留
- **WHEN** a non-MAUI fixture contains a selectable source file such as `bin/rails` and has no project rule excluding `bin/`
- **THEN** the source file remains selected

#### Scenario: 项目规则变化可审计
- **WHEN** the root `.excavatorignore` recipe changes
- **THEN** `selectionDigest` changes and the ledger reports the new project-ignore count separately from global defaults
