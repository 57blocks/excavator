## Why

`/excavator-prd-report` 拼出的 `PRD.md` 比同一子项目的单篇 `/excavator-prd` 长 4 倍（字节 5 倍）。在上一次真实运行（多仓库语料的一个 51 文件后端成员）上逐节量过，多出来的一部分是重复：

1. **流程章节各写一遍共享内容。** 8 个流程与自动类章节里有 21 个不是流程的 `###` 小节（权限、角色矩阵、字段字典、配置、概述），约 44 KB；其中 5 张角色表重复了角色与权限 `reference` 章节的矩阵。泳道提示词的深度要求写着每个功能给一张角色 × 能力表，和「流程章节引用 `reference` 章节、不重复」互相矛盾。
2. **同一个待确认问题几章各问一次。** 10 章共 90 行待确认项，分成 10 张列不统一的表；例如「客户用户如何拿到令牌」在三章各问一次。每个泳道只看得到自己的种子文件，章节之间不知道彼此问过什么。

## What Changes

- **流程章节只有流程**：`flow` 与 `automated` 章节的每个 `###` 标题必须是 `flows` 里的一个流程或 `openItems` 那个标题；第一个 `###` 之前的章节引言写功能的流程图、概述与衔接。角色 × 能力矩阵、字典表与多个流程共用的设置写在 `reference` 章节；每个流程只写哪些角色能发起、各自看到什么。`check-lane` 检查，泳道提示词的深度要求与章节结构同步改写。`reference` 章节不受限。
- **待确认项写成统一的三列表**：每章的待确认项小节是一张三列表（事项、已知什么、搜过哪里），`check-lane` 检查。
- **合并重复的待确认项**：核对与定级之后，一个合并子代理只读各章待确认项的清单（脚本抽出、编号），把问同一个问题的事项分成组，每组指定保留哪一条。它不写任何自己的文字。脚本核对每条事项至多在一个组、清单没有变过，再生成 `## Open items`：一张表，每组一行（保留那条的原文），列出提过它的功能。合并缺失或不过检查时，每条事项各占一行，覆盖小节写明没有合并。
- **两条新的章节检查只在泳道检查时做**：`aggregate` 对核对过的章节不重做，旧产物目录续跑不受影响，`index.json` 格式不变。

**不做**：
- 把已确定的事项移进正文、把事实或缺陷从待确认项改进 findings。
- 给流程粒度或篇幅定上限。
- 单篇 `/excavator-prd` 与报告页代码的改动（页面总览已经渲染 `tables/open-items.md`）。

## Capabilities

### Modified Capabilities

- `prd-report`：章节的结构声明（流程章节只有流程、待确认项三列表）、产物目录与拼装（合并后的待确认项）。

## Impact

- `skills/excavator-prd-report/`：`SKILL.md`（泳道提示词的深度要求、章节结构与待确认项格式；Phase 3 的合并步骤与合并提示词）、`lib/lane-check.mjs`、新增 `lib/open-items.mjs`、`prd.mjs`（`check-open-items`）、`lib/aggregate.mjs`、`lib/tables.mjs`；仓库根目录 `README.md` 里 `/excavator-prd-report` 的说明。
- 测试：`tests/skill/excavator-prd-report/`、`tests/skill/test_prd_report_skill_contract.test.mjs`。
