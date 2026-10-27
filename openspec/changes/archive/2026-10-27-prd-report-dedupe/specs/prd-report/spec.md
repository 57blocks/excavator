## MODIFIED Requirements

### Requirement: 章节的结构声明

编排者 SHALL 在索引的 `actors` 里把项目的每个参与者（用户类别、外部系统、其他服务、运维）列一次。每个泳道 SHALL 在章节 front-matter 里声明：`actors`（发起或参与流程的参与者，只取索引 `actors` 里的名字，逐字相同）、`permissionRoles`（权限模型里的具名角色，原样拼写）、`flows`（本章每个流程的 `###` 标题，与正文逐字相同）与可选的 `openItems`（集中列出待确认项的 `###` 标题，必须是本章最后一个 `###`）。`actors` 与 `permissionRoles` MUST NOT 相交；`flow` 与 `automated` 功能 SHALL 至少声明一个流程，`reference` 功能 MUST NOT 声明流程；正文 SHALL 恰好有一个 `##` 标题且它是第一个标题。`flow` 与 `automated` 章节的每个 `###` 标题 SHALL 是 `flows` 里的一项或 `openItems`：角色 × 能力矩阵、字典表与多个流程共用的设置写在 `reference` 章节，流程章节按名字引用它，第一个 `###` 之前的引言写功能的流程图、概述与衔接。待确认项小节 SHALL 只有一张三列表（事项、已知什么、搜过哪里）。脚本 SHALL 检查这些声明与正文一致，不一致时该泳道不过检查；`aggregate` 对已核对的章节 SHALL 重做同样的检查（流程章节只有流程与待确认项三列表两条除外），核对改坏结构时该功能为 `failed` 并记原因。

#### Scenario: 流程标题对不上
- **WHEN** 某章 `flows` 里的一项与正文的任何 `###` 标题都不逐字相同
- **THEN** `check-lane` 退出非零并打印该标题，功能按失败处理

#### Scenario: 参与者与权限角色混写
- **WHEN** 同一个名字既在 `actors` 又在 `permissionRoles`
- **THEN** `check-lane` 退出非零并打印这个名字

#### Scenario: 参与者不在名单里
- **WHEN** 某章 `actors` 里有一个索引 `actors` 没有的名字
- **THEN** `check-lane` 退出非零并打印这个名字；`Actors by feature` 的列只取索引名单里的名字

#### Scenario: 核对在章节里加了标题
- **WHEN** 一章核对之后正文出现第二个 `##` 标题
- **THEN** `aggregate` 把该功能记为 `failed` 并打印原因，`PRD.md` 正文没有它的章节

#### Scenario: 流程章节里的权限小节
- **WHEN** 一个 `flow` 章节有一个 `### Permissions` 小节，它不在 `flows` 里，也不是 `openItems`
- **THEN** `check-lane` 退出非零并打印这个标题；同样的章节在 `aggregate` 的重检里不判失败

#### Scenario: 待确认项不是三列表
- **WHEN** 某章的待确认项小节是列表，或是一张四列表
- **THEN** `check-lane` 退出非零并说明待确认项小节要是一张三列表

### Requirement: 产物目录与单文件拼装

`excavator-prd-report` 的产物 SHALL 是一个目录：`index.json`、`overview.md`、`features/`、`findings/`、`verification/`、`tables/`、`open-items/`、`findings.json`、拼装出的 `PRD.md` 与报告页 `report.html`。`PRD.md` SHALL 由脚本依次拼装：总览（文档信息、目的与能力地图、自动行为）、术语表、流程索引、角色（参与者按功能、权限角色按功能）、`reference` 章节、其余章节（按 `chapter` 顺序，去掉各自的待确认项小节）、汇集的待确认项与附录（覆盖表、核对表、失败的功能及原因）。术语表、流程索引、角色两张表与待确认项 SHALL 由脚本从 `index.json` 与章节声明生成，MUST NOT 由模型转写；总览 MUST NOT 含词表、角色、流程清单与待确认项，脚本检查总览有标题与能力图。汇集的待确认项 SHALL 是一张表：脚本从各章的待确认项小节抽出事项并编号，一个合并子代理只给出哪些事项问的是同一个问题、每组保留哪一条，不写文字；另一个核对子代理只读事项清单与分组，逐条判断回答了保留那条是否也就回答了这一条，判否的事项各自回到自己的一行；脚本核对每条事项至多在一组、事项清单与合并时相同，每组一行（保留那条的原文）并列出提过它的功能，不在组里的事项各一行；合并或核对缺失、不过检查时每条事项各一行，覆盖小节写明没有合并。流程索引的每一行 SHALL 链接到 `PRD.md` 里该流程的标题。同一输入 SHALL 得到字节相同的输出。脚本生成的表、附录标题与其中的固定词 SHALL 为英文，与 `--language` 无关；模型写的总览、章节与 findings 陈述跟随 `--language`。

#### Scenario: 重复拼装
- **WHEN** 对同一产物目录执行两次 `assemble`
- **THEN** 两次 `PRD.md` 字节相同

#### Scenario: 有失败的功能
- **WHEN** 某功能的状态是 `failed`
- **THEN** `PRD.md` 的附录列出它的 id、名称与失败原因，正文没有它的章节

#### Scenario: 文档骨架
- **WHEN** 一次运行写成了一个 `reference` 功能与若干流程功能，其中一章有待确认项小节
- **THEN** `PRD.md` 的小节顺序为总览、Terminology、Flow index、Roles、`reference` 章节、流程章节、Open items、Appendix；该小节的事项只出现在 Open items 下，章节里没有核对摘要

#### Scenario: 流程索引
- **WHEN** 各章共声明了 N 个流程、有 R 个 `reference` 功能
- **THEN** 流程索引有 N + R 行，每行的链接指向 `PRD.md` 里存在的标题，同名标题也指向各自那一个

#### Scenario: 三章问了同一个问题
- **WHEN** 三章各有一条问同一个问题的待确认项，合并子代理把它们分成一组并保留其中一条
- **THEN** `## Open items` 里这个问题只有一行，文字是保留那条的原文，另两条的事项原文以 `Also asked in <功能 id>:` 列在同一格里，Features 列有这三个功能

#### Scenario: 核对否决了一条
- **WHEN** 合并子代理把两个不同的问题分进一组，核对子代理对其中一条判否
- **THEN** 这条事项在 `## Open items` 里有自己的一行，含它自己的已知与搜过；覆盖小节写明核对退回了几条

#### Scenario: 合并之后章节变了
- **WHEN** 合并之后某章重新核对，待确认项的文字变了
- **THEN** `check-open-items` 报告合并文件对应的是别的事项并退出非零；`aggregate` 让每条事项各占一行，覆盖小节写明没有合并
