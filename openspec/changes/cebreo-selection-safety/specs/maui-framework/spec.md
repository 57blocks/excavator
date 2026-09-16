## MODIFIED Requirements

### Requirement: 构建与覆盖产物移出扫描分母

For a MAUI repository, the host skill SHALL inspect scan evidence and express project-specific generated trees such as `bin/`, `.unit-test/`, `TestResults/`, `.vs/`, `.gradle/`, and `.scratch/` in the authoritative root `.excavatorignore`. The global defaults SHALL continue to exclude universally generated outputs such as `obj/`, `coverage/`, binary extensions, and archives, but MUST NOT globally exclude `bin/` or `.unit-test/`. Before writing the project recipe, the skill SHALL compare two existing scanner outputs and prove from their dropped-file manifests that the additional rules remove no `.cs`, `.xaml`, `.csproj`, or `.feature` source. The product SHALL NOT add a MAUI- or cebreo-specific ignore registry, generator, or validator for this judgment.

#### Scenario: 去污只降噪不误伤
- **WHEN** the host skill runs the existing scanner with and without a proposed MAUI project recipe
- **THEN** it writes the recipe only after every removed file is evidenced as generated output and zero `.cs`, `.xaml`, `.csproj`, or `.feature` files are removed

#### Scenario: 其他生态的 bin 源码仍被保留
- **WHEN** a non-MAUI fixture contains a selectable source file such as `bin/rails` and has no project rule excluding `bin/`
- **THEN** the source file remains selected

#### Scenario: 项目规则变化可审计
- **WHEN** the root `.excavatorignore` recipe changes
- **THEN** `selectionDigest` changes and the ledger reports the new project-ignore count separately from global defaults
