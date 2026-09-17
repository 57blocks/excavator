产品代码仅一条声明式 `FrameworkConfig` 及其注册与测试期望；其余为 prompt 附录（`angular.md`）与只读验收。cebreo `uneeg-managementportal` 仅作 opt-in 只读校验，真实源码、绝对路径、产物一律不提交。

## 1. 冻结检测 oracle（先红）

- [ ] 1.1 在枚举 framework 的 config-schema 测试里加入 `angular` 的期望：`@angular/core`/`@angular/cli` 或 `angular.json` 命中检测、给出规定的 `layerHints`（含 `components→ui`、`services→service`、`guards→service`、`modules→config`、`pipes→utility`）与 `entryPoints`（含 `src/main.ts`、`src/app/app.module.ts`），非 Angular 项目不误报；验证该测试在实现前因缺 `angular` config 而红。
- [ ] 1.2 由 acceptor 核对 D0：确认新增仅一条声明式 config，未引入 Angular 专属检测/分派/忽略/分类产品代码，也未新增模板 parser 模块；越界即退回设计。

## 2. 实现 angular FrameworkConfig 并注册

- [ ] 2.1 新增 `packages/core/src/languages/frameworks/angular.ts`（照 `vue.ts` 形状：id `angular`、`languages ["typescript"]`、`detectionKeywords`、`manifestFiles ["package.json","angular.json"]`、`promptSnippetPath "./frameworks/angular.md"`、`entryPoints`、`layerHints`），并在 `frameworks/index.ts` 两个数组注册；验证 1.1 的检测 oracle 转绿、既有其它 framework 检测无回归。
- [ ] 2.2 提交 config + 注册 + 测试 commit；验证 `git show --stat` 不含 parser/忽略/分类模块，`FrameworkRegistry` 机制未改。

## 3. Angular 约定附录（guidance-only）

- [ ] 3.1 新增 `skills/excavator/frameworks/angular.md`（照 `maui.md` 结构）：规范文件角色表（`@Component`/`templateUrl`↔`.html`/`@Injectable`/`@NgModule`/guard/interceptor/pipe/directive、Kotlin/Spring 后端边界）、模板语法与「组件↔模板依 `templateUrl`/`selector` 证据关联、同置/同名不臆造」、以及「据约定推出的关系一律 `inferred`、无 evidence、不进确定性事实」。验证附录与 spec 两条 Requirement 逐点对应。
- [ ] 3.2 提交 `angular.md` commit；验证仅新增该附录，注入链（SKILL.md framework addendum + 子 agent 自读）未改。

## 4. cebreo uneeg 只读验收与门禁

- [ ] 4.1 opt-in 对 `uneeg-managementportal` 只读校验：确认 `@angular/core` 命中检测报告 `angular`、`angular.md` 内容进入分析上下文、且能对一个真实组件依 `templateUrl` 关联到其 `.html`（关系为 `inferred`）；抽查无「仅因同目录/同名」的臆造连边；不写真实源码/路径/产物，遗漏与编造分开记录。
- [ ] 4.2 运行 `openspec validate web-angular-support --strict` 与 `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`（含 core 包测试）；全绿后确认无 parser/忽略/分类产品代码、主 checkout 与其它活跃 change 未被触及。
