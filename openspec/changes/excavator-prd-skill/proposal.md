## Why

Excavator 已有围绕知识图的一组 skill（`excavator-chat`、`excavator-onboard`、`excavator-domain` 等），但没有一个能从代码反向产出一份**面向产品经理、覆盖全流程的 As-Is PRD**——把一个功能「现在到底怎么用」讲清楚：前端表单规则、后端处理、权限、通知、定时任务、每个数字怎么算，供产品与新人阅读。

现有知识图是**调用/结构关系**。通知、定时任务、权限、跨服务调用这些产品可见行为不是调用边、不在图里；若只读图，PRD 会系统性漏掉它们（wcp「工时记录」的真实反馈已证明这一点）。因此需要一个 skill：以图加速流程发现，同时从源码补齐 off-graph 行为，产出不精选、可读（表格/列表/mermaid）、正文无代码、证据可折叠的 PRD。

## What Changes

- 新增 skill `excavator-prd`：从知识图 + 源码反向生成 As-Is PRD，默认读者为产品经理（`--role` 可调），输出语言由 `--language` 决定。
- 流程：Phase 0 判定 graph-assisted / source-only（缺图回退直接读源码）→ Phase 1 建**完整流程清单**（图内调用流 + 源码 hunt 出通知/定时/权限/外部服务 + 前后端端到端缝合）→ Phase 2 按角色排大纲 → Phase 3 写 PRD（正文无代码、枚举翻译、证据折叠 `<details>`、表格 + mermaid）→ Phase 4 覆盖/图/枚举三项自检。
- 零产品代码：仅新增 `skills/excavator-prd/SKILL.md`（散文编排），复用现有 MCP 图工具与 `skills/excavator/consumer-freshness.mjs`；不新增脚本、registry 或 validator。
- 文档与测试对齐：README 增加 `/excavator-prd` 用法；`tests/install/install.test.mjs` 断言该 skill 随插件安装。

## Capabilities

### New Capabilities

- `prd-generation`: 定义「从代码反向产出 As-Is PRD」为一个 AI-first skill 能力——完整流程清单（含 off-graph 行为与端到端缝合）、按角色的大纲、无代码正文与枚举翻译、可折叠证据，以及覆盖不精选的自检地板；graph 缺失时回退纯源码。

## Impact

- 仅新增 `skills/excavator-prd/`（prose-only）与文档/测试引用；不新增 runtime 依赖或产品代码模块，`.excavator/` 布局不变。
- 其它 skill、agent、spec 的确定性契约不变；安装后可用 `/excavator-prd`（插件缓存需重装刷新才生效）。
- `check-refs` 门要求 `SKILL.md` 的 `name` 与目录名一致、引用可解析——本 skill 均满足。
