## Why

cebreo 的 web 项目 `uneeg-managementportal` 是 Angular 前端 + Kotlin/Gradle 后端。`.ts` 组件与 Kotlin 后端的结构抽取都正常，但**没有 Angular 的 `FrameworkConfig`**：分析 web 项目时不会检测出 Angular，也没有任何 Angular 约定被注入分析上下文，AI 拿不到「`@Component` 的 `templateUrl` 关联哪个 `.html`、`@Injectable`/`@NgModule`、模板绑定语法」这类指引，组件↔模板↔服务的关系无从可靠推导。mobile 侧的对等能力（`maui`）早已具备；web 侧应对齐同一模式。

## What Changes

- 新增 `angular` 的 `FrameworkConfig`（`packages/core/src/languages/frameworks/angular.ts`）并在 `frameworks/index.ts` 注册：以 `package.json` 的 `@angular/core`/`@angular/cli` 与 `angular.json` 检测，提供 `layerHints`（`components→ui`、`pages→ui`、`services→service`、`guards/interceptors/resolvers→service`、`directives→ui`、`pipes→utility`、`modules→config`、`store/effects→service`）与 `entryPoints`（`src/main.ts`、`src/app/app.module.ts`）。
- 新增 Angular 约定附录 `skills/excavator/frameworks/angular.md`，作为 prompt 附录教 AI Angular 规范文件角色与关系：`@Component`（`selector`/`templateUrl`↔`.html`/`styleUrls`）、模板语法（`*ngFor`/`*ngIf`/`[prop]`/`(event)`/`[(ngModel)]`/`{{}}`/组件选择器作标签）、`@Injectable` + 构造注入、`@NgModule`、路由与 `guard`/`interceptor`、与 Kotlin/Spring 后端的边界。据附录推出的关系一律 `provenance:"inferred"`、无 evidence、不进确定性事实（沿用 `maui.md` 的 guidance-only 契约）。
- Angular 模板 `.html` 继续经 `compute-batches` 的 Group E 兜底进入 AI 批次被读；由 `angular.md` 指引 AI 把组件 `.ts` 与其 `templateUrl` 指向的 `.html` 关联，关系依证据推导。

## Capabilities

### New Capabilities

- `angular-framework`: 定义从 web manifest 确定性检测 Angular、提供目录分层提示，以及 `angular.md` 约定附录只作 guidance（inferred、无 evidence、不成确定性事实）的契约。

### Modified Capabilities

（无：`scan-project`、tree-sitter 抽取、`FrameworkRegistry` 机制、合并脚本的既有契约不变，只新增一个 framework 条目。）

## Impact

- 新增一个声明式 `FrameworkConfig`（照 `vue.ts`/`react.ts`/`maui.ts` 模式）与一个 prompt 附录 markdown；`frameworks/index.ts` 增一处注册；相应更新枚举 framework 的 config-schema 测试期望。
- **不写 Angular 模板 parser**：JS 前端框架家族（React 内联 JSX、Vue 的 `.vue` 分离 `<template>`）一律只用 `config + snippet + AI`，均无模板 parser；`XamlParser` 是 MAUI/.NET 生态例外，不套用于此。
- **不新增 Angular 专属忽略/生成目录分类码**：`dist/`、`.angular/`、`node_modules` 等构建产物交既有 agent-owned ignore preflight 与通用默认处理，不进产品代码。
- 无新 runtime 依赖，不改 `.excavator/` 契约。不做 Angular 模板→组件成员的确定性 resolver、不做跨文件确定性绑定解析（如需，另立变更并过同一 AI-first 关卡）。
