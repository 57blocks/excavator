## ADDED Requirements

### Requirement: 视角

`--views` SHALL 决定手册写出哪些视角，取值 `product`、`technical` 或两者（逗号分隔），默认 `product`。其他取值 SHALL 被拒绝，并打印可选值。视角 SHALL 只决定 `assemble`、`page` 与回复输出什么，SHALL NOT 改变运行哪些阶段，SHALL NOT 记进 `state.json`；换视角续跑只是重新拼装。

产品视角按领域导航，SHALL NOT 显示任何引文路径。技术视角按应用导航，SHALL 为每个已核实的项列出它每段引文的文件与行范围，概览与每个功能各一节；行范围 SHALL 由脚本按引文段落在文件中的位置算出，与引文核对定位的一致。

#### Scenario: 默认只写产品视角
- **WHEN** 不带 `--views` 运行
- **THEN** 只写 `handbook.md` 与只含产品视角的 `handbook.html`，页面没有视角切换

#### Scenario: 两个视角
- **WHEN** 以 `--views product,technical` 运行
- **THEN** 写出 `handbook.md` 与 `handbook-technical.md`，`handbook.html` 的顶栏有视角切换，在一个功能页上切换后仍停在该功能

#### Scenario: 非法取值
- **WHEN** 以 `--views design` 运行
- **THEN** 脚本退出 1，打印 `product` 与 `technical`

### Requirement: 实体与关系

脚本 SHALL 从已载入并重新核对过的运行与系统事实，确定性地算出以下实体：领域（地图的区域）、功能、角色、应用（每个应用根目录，以及已核实概览在其下列出的子应用）、定时任务、通知、外部集成（已核实概览的项）。

实体之间的关系 SHALL 由脚本算出，SHALL 只取 `verified` 的单元，SHALL NOT 调用模型：
- 功能与应用：功能的每段引文归到目录最长匹配的应用，按应用计引文数；
- 角色与功能：条目「谁能用」里写明该角色能做的事；
- 领域与应用：该领域各功能落在该应用中的引文数之和；
- 通知与定时任务各链到它的功能；
- 外部集成与应用，分开的两种关系：概览项所列、经过核对的调用方；以及源文件里按字面（区分大小写）出现该系统名的应用，带出现的文件数；文件按目录最长匹配归到应用。落在任何应用之外的引文与含该名称的文件 SHALL 单独计数，不丢弃。

关系与矩阵的标题 SHALL 只写实际检查了什么，例如「引文落在该应用中的功能」「源码里出现该名称的应用」，SHALL NOT 写成「该应用实现的功能」「调用它的应用」。手册与页面 SHALL 写明这些关系只计已核实的条目。

手册 SHALL 含两张矩阵：角色 × 功能（单元格是条目里写明该角色能做的事），以及应用 × 领域（单元格是引文数）。产品视角只含前一张。

同样的输入 SHALL 得到同样的字节。

#### Scenario: 最长匹配
- **WHEN** 一个应用根目录 `svc` 下另有概览列出的子应用 `svc/admin`，一段引文在 `svc/admin/a.go`
- **THEN** 这段引文计入 `svc/admin`，不计入 `svc`

#### Scenario: 未核实的条目不进关系
- **WHEN** 一个功能的状态是 `confirmed`
- **THEN** 它的引文与「谁能用」都不进任何关系与矩阵

#### Scenario: 模型漏列的调用方
- **WHEN** 概览项「Slack」只列了调用方 `a`，而应用 `b` 的源文件里也出现 `Slack`
- **THEN** 「引文所示的调用方」只有 `a`，「源码里出现该名称的应用」有 `a` 与 `b`，两栏分开显示

## MODIFIED Requirements

### Requirement: 拼装手册

`assemble` SHALL 从地图与通过检查的条目确定性地生成手册：产品视角写 `handbook.md`，技术视角写 `handbook-technical.md`，只写所选的视角，并删去没选的视角上次留下的文件。同样的输入得到同样的字节，不含时间和本机路径；产品视角的正文不含引文路径。手册 SHALL 按区域组织功能，并含覆盖一节：候选总数与守恒结果、`unassigned` 清单、`link` 功能清单、各到达方式的计数、没有条目或条目失败的功能。

#### Scenario: 两次拼装
- **WHEN** 输入不变，运行两次 `assemble`
- **THEN** 两份手册逐字节相同

#### Scenario: 覆盖可见
- **WHEN** 地图里有未归入的候选和没有条目的功能
- **THEN** 覆盖一节列出它们，计数与地图一致

#### Scenario: 换视角后不留旧文件
- **WHEN** 先以 `--views product,technical` 拼装，再只以 `--views product` 拼装
- **THEN** 输出目录里不再有 `handbook-technical.md`

### Requirement: HTML 导出

`page` SHALL 把地图、通过检查的条目、状态、算出的实体与关系和固定文字表写成一个 `handbook.html`。该页面 SHALL 双击即可从磁盘打开，不需要服务器、网络或安装任何东西，SHALL NOT 发起任何网络请求。页面 SHALL 有：所选视角的导航（产品视角按区域，技术视角按应用）、每个功能的页面、实体页、覆盖页，并且在手机宽度下没有横向滚动。选了两个视角时，顶栏 SHALL 有视角切换，切换后停在同一实体，另一视角没有这个实体时回到概览。页面上的固定文字 SHALL 全部来自固定文字表，页面的语言标签 SHALL 与 `--language` 一致。同样的输入 SHALL 得到同样的字节，不含时间和本机路径；产品视角的正文与页面数据里产品部分不含引文路径。

#### Scenario: 从磁盘打开
- **WHEN** 在没有网络的机器上双击 `handbook.html`
- **THEN** 导航、功能页、实体页与覆盖页都能显示，没有网络请求，也没有控制台错误

#### Scenario: 中文页面
- **WHEN** 以 `--language Chinese` 运行并导出
- **THEN** 页面上的栏目名、表头与按钮都是中文，`<html lang>` 是中文的语言标签
