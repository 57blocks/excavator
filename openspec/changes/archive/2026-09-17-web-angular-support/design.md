## Context

见 `proposal.md` 的 Why。现有 `FrameworkConfig` 机制（`packages/core/src/languages/frameworks/*.ts` + `frameworks/index.ts` 注册 + `promptSnippetPath` 指向 `skills/excavator/frameworks/<id>.md`）已支撑 react/vue/nextjs/express/spring/maui 等；检测到框架后，SKILL.md 的 framework addendum 注入把 `frameworks/<id>.md` 全文追加进 file-analyzer/architecture-analyzer 上下文（`excavator-file-analyzer` 也会自行读取）。`.ts` 走 tree-sitter typescript 抽取，Angular 模板 `.html`（非代码）经 `compute-batches` 的 Group E 兜底进入 AI 批次。缺的只是 `angular` 这一条 framework 条目与其约定附录。

## Goals / Non-Goals

**Goals:**

- 让 web 前端项目被检测为 `angular` 并注入 Angular 约定，使组件/模板/服务/模块关系可由 AI 依证据推导。
- 严格复用既有 `FrameworkConfig` 机制与注入链，改动与 vue/react/maui 逐点同构。

**Non-Goals:**

- 不写 Angular 模板 parser、不写 Angular→组件成员的确定性 resolver、不做跨文件确定性绑定解析。
- 不新增 Angular 专属忽略/生成目录分类产品代码。
- 不改 tree-sitter 抽取、`compute-batches` 或合并脚本。

## Decisions

### D0. 落码的边界：只加一条声明式 FrameworkConfig，其余全是 prompt/AI（AI-first scope gate）

AGENTS.md 的 scope gate 允许落码的是：确定性可复用、机器可校验、安全/持久化边界，或 agent 无法在可接受成本内稳定完成的能力。

- **落码的部分**：`angular.ts` `FrameworkConfig` + 在 `index.ts` 注册。它是**确定性、可复用、可机器校验**的检测与分层声明（关键词匹配 manifest、layerHints 表），且是本仓库既定的框架扩展点——react/vue/maui 全走这里。这属于「声明式契约」，是零模型 Core 认可的依赖形态。**它照抄 vue.ts 的形状，零新机制。**
- **不落码的部分**：Angular 的语义（什么是组件、模板绑定、DI、组件↔模板关系）是**理解题**，由 `angular.md` 附录 + AI 完成，产出 `inferred` 关系。

### D1. 对标 vue，而非 XamlParser（为什么前端模板不写 parser）

React 的 JSX 内联在 `.tsx`（tree-sitter 已覆盖）；Vue 的 `.vue` 有**分离的 `<template>` 标记段**，却依然 **no-extractor**、**无 parser**——只有 `vue.ts` + `vue.md` + AI。Angular `.html` 与 `.vue` 的处境相同（分离模板标记、no-extractor、经 Group E 进 AI 批次）。因此一致且更 AI-first 的做法是对标 vue：**config + snippet + AI，不写模板 parser**。

`XamlParser` 是反例但不适用：它服务 MAUI/.NET 生态，抽的是高度结构化、后续要与 C# 符号做确定性 resolve 的绑定事实（`x:Class`↔code-behind、`x:DataType`）。JS 前端框架家族没有这套确定性 resolve 目标，写模板 parser 只会得到一套僵硬且易误判的启发式，违反 scope gate。

替代方案「写 AngularTemplateParser 抽模板结构」被否决：与 vue/react 家族不一致、增加产品代码、且模板↔组件关系本就该是 AI 依证据推导的 `inferred` 关系而非确定性事实。

### D2. 构建产物交既有 ignore 机制，不新增 Angular 专属规则

maui-framework spec 曾把 `bin/obj/dll` 等移出扫描分母。Angular 的对应产物是 `dist/`、`.angular/`、`node_modules`。但 selection-safety 已提供 **agent-owned ignore preflight**——由 agent 从证据提议项目忽略、人可核对，且明确禁止把该判断固化成 registry/classifier/generator。因此本变更**不**新增 Angular 专属忽略默认或分类码，构建产物由既有 preflight 与通用默认处理。这既避免重复、又守住 scope gate（不把"哪些是生成目录"固化成确定性代码）。

## Risks / Trade-offs

- [AI 仅因组件与模板同目录/同名就臆造关联] → spec 明确「同置/同名不构成臆造依据」，`angular.md` 要求以 `templateUrl`/`selector` 等证据为准；验收在 cebreo uneeg 上抽查一个组件的关联是否来自证据。
- [注入未生效——检测到 angular 却没读 angular.md] → 复用既有注入链（SKILL.md framework addendum + 子 agent 自读）；验收确认检测命中且 `angular.md` 内容进入分析上下文。
- [config-schema 测试因新增 framework 未更新期望而红] → 实现时同步更新枚举 framework 的测试期望（与 maui 加入时同法）。
- [Kotlin/Spring 后端与 Angular 前端混淆分层] → `angular.md` 划清前后端边界；后端已有 `spring` framework 与 Kotlin 抽取，各自检测互不干扰。

## Migration Plan

无数据迁移，无新依赖。回滚为移除 `angular.ts`、其注册与 `angular.md`；其余框架与抽取不受影响。分阶段落地：先加 config + 注册 + 测试期望（可机器校验），再加 `angular.md` 附录，最后 cebreo uneeg 只读验收（不提交真实源码/路径/产物）。
