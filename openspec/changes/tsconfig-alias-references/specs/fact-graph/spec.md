## ADDED Requirements

### Requirement: TS/JS 路径别名跟随 tsconfig 的 references 与 extends

import map 为 TS/JS 文件解析路径别名时，SHALL 从文件所在目录向上找最近的 `tsconfig.json`，并使用它给出的全部作用域：

- 它自己的 `baseUrl` 与 `paths`，作用于向上找到它的所有文件；
- 它 `references` 里每一项指向的配置（配置文件，或含 `tsconfig.json` 的目录）的 `baseUrl` 与 `paths`，只作用于被引用配置所在目录之内的文件。被引用的配置 SHALL 从磁盘读取，不要求出现在文件清单里。只跟随一层 `references`。

每个配置的 `baseUrl` 与 `paths` SHALL 经以 `.` 开头的相对路径 `extends`（字符串或数组，后者按顺序合并）继承，自己写的覆盖继承的，二者各自独立继承。别名目标 SHALL 锚定在有效 `baseUrl`（相对写出它的配置的目录）；没有 `baseUrl` 时锚定在写出 `paths` 的配置的目录。写成包名的 `extends` 不跟随。

一个说明符在所有适用作用域里解析出的不同文件：

- 恰好一个时，SHALL 生成 `imports` 边；
- 两个以上时，MUST NOT 生成边，SHALL 记入 import map 的 `ambiguous`（文件 → 说明符 → 候选文件，按路径排序），且 MUST NOT 同时记入 `unresolved`；
- 没有时，照旧记入 `unresolved`。

存在但读不了或解析不了的配置 SHALL 记一条 `failures`（同一文件只记一次）并输出 Warning:；`extends` 或 `references` 指向不存在的文件、离开项目根目录（字面路径或 realpath 越界）、`extends` 成环时 SHALL 只输出 Warning:，不记 `failures`，不读越界的文件。import map SHALL 输出 `tsConfigFiles`：构建别名时读过的全部 tsconfig 文件，按路径排序；增量运行在其中任一文件被改动时 SHALL 重算整张 import map。

#### Scenario: 解决方案式根配置
- **GIVEN** 根 `tsconfig.json` 为 `{"files": [], "references": [{"path": "./tsconfig.app.json"}, {"path": "./tsconfig.node.json"}]}`，`tsconfig.app.json` 带注释，`baseUrl: "."`、`paths: {"src/*": ["./src/*"]}`，`src/App.tsx` import `src/common/components`、`src/utils/format`、`./local` 与 `react`
- **WHEN** import map 构建
- **THEN** `src/App.tsx` 指向 `src/common/components/index.ts`、`src/local.ts`、`src/utils/format.ts`，`unresolved` 只有 `react`，`failures` 为空

#### Scenario: 被引用配置只作用于自己的目录
- **GIVEN** 根配置引用 `packages/web/tsconfig.lib.json`，后者定义 `@web/*`；`packages/web/src/a.ts` 与 `scripts/tool.ts` 都 import `@web/b`
- **WHEN** import map 构建
- **THEN** `a.ts` 指向 `packages/web/src/b.ts`；`tool.ts` 没有边，`@web/b` 在它的 `unresolved` 里

#### Scenario: 两个配置给出不同文件
- **GIVEN** 根配置引用两个配置，一个把 `@/*` 映射到 `./app/*`，一个映射到 `./web/*`，`app/foo.ts` 与 `web/foo.ts` 都存在，只有 `web/only.ts` 存在
- **WHEN** `main.ts` import `@/foo` 与 `@/only`
- **THEN** `main.ts` 只有到 `web/only.ts` 的边；`ambiguous` 为 `{"main.ts": {"@/foo": ["app/foo.ts", "web/foo.ts"]}}`；`@/foo` 不在 `unresolved` 里

#### Scenario: 经 extends 继承别名
- **GIVEN** `tsconfig.base.json` 在根目录定义 `baseUrl: "."` 与 `@shared/*`；`packages/a/tsconfig.json` 只写 `extends: "../../tsconfig.base.json"`
- **WHEN** `packages/a/src/main.ts` import `@shared/s`
- **THEN** 它指向 `libs/shared/s.ts`（锚定在基础配置的目录，而不是 `packages/a`）

#### Scenario: 增量运行看见共享基础配置的改动
- **GIVEN** 别名经根配置引用的 `tsconfig.app.json` 再 `extends` 到 `configs/shared.json`，一次提交只改了 `configs/shared.json` 的别名目标
- **WHEN** 增量运行
- **THEN** 未改动的 importer 被重新解析到新的目标
