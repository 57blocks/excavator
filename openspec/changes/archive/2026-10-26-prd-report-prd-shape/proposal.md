## Why

用户要求 `/excavator-prd-report` 拼出的 `PRD.md` 和单篇 `/excavator-prd` 写出的「差不多」。在同一个子项目上对比两份产物（多仓库语料的一个 51 文件后端成员，各自真实运行一次），单个流程的写法已经一致：目的、角色、触发、前后端步骤、时序图、规则、边界情况、可折叠证据。差在三处：

1. **没有文档级骨架。** 单篇有术语表、能力地图、带章节指向的流程索引、全局的角色与权限（角色字典、状态字典、角色 × 能力矩阵）、集中的待确认项，核对摘要只在文末。拼装版的术语是列表，没有流程索引；角色总表有 24 列，15 个权限角色与系统调用方混在一起；权限模型埋在一个流程章节里；待确认项散在各章；核对摘要夹在每章正文中间（`excavator-verify --fix` 在文末追加，拼装后落在章节之间）。
2. **前端一侧是空的。** `--scope` 指向后端子目录时，泳道只读范围内的文件，每个流程的 Frontend 都写成「代码里看不出」；单篇读了同项目的前端与下游服务，写出了登录页的校验、提示与跳转，以及谁调用权限检查。
3. **一个功能失败就丢一整章。** 第三方授权功能的泳道把锚点写到了项目外的依赖缓存里，`check-lane` 判失败；编排者没有按规定重派第二次（`attempts` 停在 1），六个流程整章缺席。

## What Changes

- **共享模型章节**：功能新增 `kind: "reference"`，写多个流程共用的模型（角色与权限、令牌模型、共用的状态字典）：字典表、角色 × 能力矩阵、判定过程。它们排在流程章节之前，可以没有入口候选。
- **章节声明结构字段**：front-matter 的 `roles` 拆成 `actors`（发起或参与流程的用户类别与外部系统）与 `permissionRoles`（权限模型里的具名角色），两者不相交；新增 `flows`（每个流程的 `###` 标题，原文一致）与 `openItems`（集中待确认项的那个 `###` 标题，必须是本章最后一个 `###`）。`check-lane` 检查这些字段与正文一致。
- **脚本拼装文档骨架**：`PRD.md` 依次为总览（Doc Info、目的与能力地图、自动行为）、`## Terminology`（由 `index.json` 的词表生成）、`## Flow index`（由各章 `flows` 生成，链接到章节标题）、`## Roles`（`Actors by feature` 与 `Permission roles` 两张表）、共享模型章节、流程章节、`## Open items`（从各章的待确认项小节搬出并按功能汇集）、附录。总览不再写词表与角色。
- **核对摘要不进章节**：`excavator-verify` 新增 `--no-summary`，与 `--fix` 同用时不在文末追加摘要；`excavator-prd-report` 核对每章时带上它。`aggregate` 检查核对后的章节仍只有一个 `##` 标题。
- **跨层读取**：`--scope` 指向子目录时，编排者在范围外搜寻范围内入口的调用方（发请求的页面与客户端、调用它的其他服务），把这些文件加入功能的 `seedFiles`；泳道据此写前端与衔接。附录的覆盖小节由脚本列出范围外读过的文件按顶层目录的计数。
- **锚点只指项目代码**：泳道提示词写明项目外（依赖缓存、标准库、安装的包）的代码不能作为证据；`check-lane` 拒绝落在 `node_modules`、`vendor` 等被入口扫描跳过的目录里的锚点与引文。
- **失败不静默停在第一次**：`check-lane` 失败时最后一行打印下一步（`Next: re-dispatch <id> once ...` 或 `Next: <id> stays failed ...`）；最后的回复在有可重试的失败功能时多一行，说明再跑同一命令会重试哪些功能。
- **格式升级**：`index.json` 的 `format` 升为 `excavator-prd-report/2`；旧格式的产物目录不续跑，提示用 `--fresh`。
- **报告页**：总览显示术语、流程索引（链接到功能页）、角色两张表与待确认项；功能页显示 `actors` 与 `permissionRoles`。

**不做**：
- 改单个流程的写法模板（已与单篇一致）。
- 让模型写任何由脚本生成的表。
- 单篇 `/excavator-prd` 的任何改动。

## Capabilities

### Modified Capabilities

- `prd-report`：完整流程清单（`reference` 功能、范围外调用方）、按功能并发与续跑（格式、失败后的下一步）、产物目录与拼装（文档骨架）、写给用户的话与最后的回复（可重试的失败功能）、报告页（总览的骨架小节）、发现的优先级（旧产物目录的场景随格式升级改写）。
- `document-verification`：`--fix` 可用 `--no-summary` 不追加摘要。

## Impact

- `skills/excavator-prd-report/`：`SKILL.md`（Phase 1 的共享模型与范围外调用方、泳道提示词、总览、核对参数、回复）、`lib/front-matter.mjs` 不变（新字段都是标量或字符串列表）、`lib/lane-check.mjs`、`lib/index-check.mjs`、`lib/aggregate.mjs`、`lib/tables.mjs`、`lib/assemble.mjs`、`lib/page-data.mjs`、`lib/reply.mjs`。
- `skills/excavator-verify/SKILL.md`：`--no-summary`。
- `packages/prd-report-page/`：总览的骨架小节、流程索引、功能页的角色字段。
- 测试：`tests/skill/excavator-prd-report/`、`tests/skill/test_prd_report_skill_contract.test.mjs`、`excavator-verify` 的契约测试、`packages/prd-report-page/test/`。
- 本变更在 `prd-report-finding-priority` 合并之后实现：两者改动同一批文件。
