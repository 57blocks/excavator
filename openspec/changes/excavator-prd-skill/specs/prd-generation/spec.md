## Purpose

定义「从代码反向产出面向指定读者的 As-Is PRD」为一个 AI-first skill 能力：以知识图加速流程发现、从源码补齐调用图看不见的行为、覆盖全流程不精选，并产出可读、正文无代码、证据可追溯的文档。

## ADDED Requirements

### Requirement: 完整流程清单覆盖全流程

`excavator-prd` SHALL 在写作前建立一份覆盖 scope 内全部流程的清单，MUST NOT 为篇幅精选或静默丢弃任何流程。清单 SHALL 同时来自知识图的调用/结构流，以及对源码的补充发现；每个流程 SHALL 缝合为跨层的端到端条目（前端触发 ↔ 后端处理 ↔ 下游副作用）。

#### Scenario: 覆盖自检
- **WHEN** 生成完成
- **THEN** skill 产出「清单项 → PRD 章节」映射并报告 `N/N`，未覆盖项要么补上要么显式标注超范围，无静默丢弃

#### Scenario: 跨网络边界的流程
- **WHEN** 一个用户流程由前端经 HTTP/gRPC 调用后端，两端之间没有源码 import 连接
- **THEN** skill 通过匹配前端请求与后端路由把两端缝合为一条端到端流程，而非割裂成两条

#### Scenario: 页面真实挂载路径
- **WHEN** 某页面组件位于某功能目录，但其路由注册在共享的 router/outlet/layout 文件中
- **THEN** skill 顺路由注册确定该页面的真实 URL 与导航语境（所属 hub/tab、默认落地路由），不从目录路径臆测路由；组件在范围内而挂载点在范围外的页面仍属范围内

### Requirement: 补齐调用图看不见的行为

`excavator-prd` SHALL 在流程发现中显式从源码搜寻不以调用边形式存在的产品行为：对外通知/消息、定时/后台任务、权限/鉴权、外部服务集成。对每一项 SHALL 记录其触发时机、作用对象与内容/效果。

#### Scenario: 通知细节
- **WHEN** 某流程成功后向外发出通知
- **THEN** PRD 写清触发时机、接收方与消息内容，而非只说「会发送通知」

#### Scenario: 缺图回退
- **WHEN** 项目没有知识图
- **THEN** skill 进入 source-only 模式，直接从源码发现流程并继续产出，而非中止

### Requirement: 面向读者、可读、正文无代码

`excavator-prd` SHALL 用 `--role`（默认产品经理）的产品语言写作，`--language` 决定输出语言。正文 MUST NOT 出现代码、签名、SQL 或配置字面量；数字枚举/状态码/字段值 SHALL 翻译为人类含义，码表只进字段字典表。证据（`file:line`）SHALL 放入可折叠区而非正文，并 SHALL 使用表格/列表/mermaid 提升可读性。

#### Scenario: 枚举翻译
- **WHEN** 某状态在源码中是数字码（如 `status=2`）
- **THEN** PRD 正文以其含义呈现（如「已完成」），裸码不出现在叙述中

#### Scenario: 图与证据
- **WHEN** 描述一条跨层流程
- **THEN** PRD 提供对应的 mermaid 图，并把该流程的 `file:line` 证据折叠在 `<details>` 中

### Requirement: 保留源专名，只翻译通用叙述

当 `--language` 与源语言不同，PRD SHALL 保留产品/功能名、模块名与 UI 可见标签（菜单、页签、按钮、字段、状态名）的源语言原形，只翻译其外围的通用叙述；MUST NOT 为已命名实体另造译名，即使它作为普通名词出现。为使其自一致，PRD SHALL 在顶部声明术语表（源术语 | 含义），并在全文（正文、标题、表格、图标签）复用这些源术语。

#### Scenario: 已命名实体在行文中被引用
- **WHEN** 描述性行文需要指代一个源语言命名的功能/实体
- **THEN** 使用其源术语原形，而非目标语言译名或同义词

#### Scenario: 术语自审
- **WHEN** 生成收尾
- **THEN** skill 枚举全文用于指代该实体的词，任一译名变体替换回源术语，报告 0 translated-variant leaks
