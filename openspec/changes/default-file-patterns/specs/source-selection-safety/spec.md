## ADDED Requirements

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
