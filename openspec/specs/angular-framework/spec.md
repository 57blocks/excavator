# angular-framework Specification

## Purpose

从 web manifest（`package.json`/`angular.json`）确定性检测出 Angular 框架并提供目录分层提示，并以 `angular.md` 约定附录教分析 agent 理解 Angular 的组件 / 模板 / 服务 / 模块结构，使 web 前端（如 cebreo 的 `uneeg-managementportal`）的组件↔模板↔服务关系可由 AI 依证据推导，而不臆造。约定只作 guidance，绝不成为确定性事实。

## Requirements

### Requirement: 从 web manifest 检测 angular 框架

系统 SHALL 提供 `angular` 的 `FrameworkConfig`，当 `package.json` 含 `@angular/core` 或 `@angular/cli`（或存在 `angular.json`）时检测为 `angular`，并提供 `layerHints`（至少覆盖 `components→ui`、`services→service`、`guards→service`、`modules→config`、`pipes→utility`）与 `entryPoints`（含 `src/main.ts`、`src/app/app.module.ts`）。该 config 沿用既有 `FrameworkConfig` 机制注册，MUST NOT 引入 Angular 专属的检测或分派产品代码。

#### Scenario: Angular 项目被检测
- **WHEN** 项目 `package.json` 含 `@angular/core`，或根目录存在 `angular.json`
- **THEN** 框架检测报告 `angular`，并给出上述 `layerHints` 与 `entryPoints`

#### Scenario: 非 Angular 项目不误报
- **WHEN** 项目不含任何 Angular 标记（无 `@angular/*`、无 `angular.json`）
- **THEN** 不报告 `angular`

### Requirement: 框架约定附录只作 guidance

若提供 `skills/excavator/frameworks/angular.md`，它 SHALL 只作 prompt 附录，教 agent 识别 Angular 规范文件角色（`@Component` 的 `selector`/`templateUrl`/`styleUrls`、`@Injectable` + 构造注入、`@NgModule`、路由与 `guard`/`interceptor`）与模板语法（`*ngFor`/`*ngIf`/`[prop]`/`(event)`/`[(ngModel)]`/`{{}}`/组件选择器作标签）：不产行号，据其推出的关系一律 `provenance:"inferred"` 且无 evidence，annotate / validate MUST NOT 把约定当确定性事实。

#### Scenario: 约定不产可引用锚点
- **WHEN** 某关系仅由 `angular.md` 约定推出（例如组件 `.ts` 与其 `templateUrl` 指向的 `.html` 的关联）
- **THEN** 该关系 `inferred` 且无 evidence，不进入确定性事实

#### Scenario: 同目录 / 同名不构成臆造依据
- **WHEN** 一个组件 `.ts` 与某 `.html` 仅仅同目录或同名，但无 `templateUrl`/`selector` 等证据表明二者关联
- **THEN** 不产它们之间的关系连边（不得仅因同置或同名臆造）
