## ADDED Requirements

### Requirement: JavaScript workspace 的成员是应用

应用列表 SHALL 把声明了 JavaScript workspace 的目录（有 `pnpm-workspace.yaml`，或 `package.json` 有 `workspaces`）当作 workspace 根：根下面最上层的清单目录各是一个应用，根本身不是；根下面没有清单目录时根本身是应用。架构事实表 SHALL 接受 `library` 种类，应用根目录 SHALL 恰好是一个 `frontend`、`backend` 或 `library` 组件。

#### Scenario: pnpm workspace

- **WHEN** 项目根有 `package.json` 与 `pnpm-workspace.yaml`，`frontend`、`backend`、`packages/contracts` 各有 `package.json`
- **THEN** 应用列表是这三个目录，不含 `.`

#### Scenario: 没有 workspace 声明

- **WHEN** 项目根有 `package.json`，没有 `pnpm-workspace.yaml`，`package.json` 没有 `workspaces`
- **THEN** 应用列表与改动前相同

### Requirement: 引文提示的精度

章节的引文检查 SHALL 在比较前解码 HTML 实体并规整空白；引号里的文字不在所引行时，提示 SHALL 写出它在所引文件或项目里第一个出现的位置，项目里没有时 SHALL 说明没有。数字检查 SHALL 不把章节一级标题里的功能编号当作正文数字。建议词表 SHALL 不含 must、need to、needs to。

#### Scenario: 实体与位置

- **WHEN** 章节引用 `Privacy & Terms`，所引行写作 `Privacy &amp; Terms`
- **THEN** 不出提示

#### Scenario: 引错了行

- **WHEN** 引号里的文字不在所引行，但在另一个文件的第 242 行
- **THEN** 提示写出那个文件与 242

### Requirement: 注释里的写法不是入口候选

入口候选 SHALL 跳过去掉前导空白后以 `//`、`/*` 或 `*` 开头的行。

#### Scenario: 注释里的装饰器

- **WHEN** 一行是 `// @Get('x')`
- **THEN** 它不是候选
