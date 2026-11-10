## ADDED Requirements

### Requirement: 按项目写的目录

运行 SHALL 在跨领域主题之后、组装之前，由编排者写 `outline.json`：把脚本列出的每个可放的块放进一个部分的一章，或者列入 `unplaced` 并写明理由。部分名与章名 SHALL 由编排者按项目来写，skill 的说明与代码 SHALL NOT 给出示例章名。`check-outline` SHALL 检查：每个可放的块恰好出现一次，块 id 都已知，部分不为空，读者文字合规，语言与地图相同。检查不过时 SHALL 打印每一个问题并以 1 退出。

页面的导航分组、链接文字、上一章与下一章和页面标题，以及 `handbook.md` 的章节顺序与章名，SHALL 都取自目录。没有目录或目录检查不过时，SHALL 使用默认目录，并在覆盖情况中用固定文字说明。列入 `unplaced` 的块 SHALL 连同理由一起出现在覆盖情况中。

#### Scenario: 漏放一个块
- **WHEN** 目录既没有把 `history` 放进任何一章，也没有把它列入 `unplaced`
- **THEN** `check-outline` 打印这个块并以 1 退出，组装使用默认目录

#### Scenario: 项目自己的章名
- **WHEN** 目录把 `business` 放进一章，章名由编排者写成项目自己的说法
- **THEN** 导航、页面标题与 `handbook.md` 的二级标题都是这个章名

#### Scenario: 产品视角
- **WHEN** 目录的一个部分只含有技术视角的块
- **THEN** 产品视角的导航不显示这个部分

### Requirement: 领域页列出功能明细

领域页 SHALL 在功能一览之后，依次列出本领域每个已核实功能的完整明细，内容与该功能的页面相同。功能一览的每一项 SHALL 链接到它的明细。

#### Scenario: 打开一个领域
- **WHEN** 读者打开一个有 3 个已核实功能的领域
- **THEN** 页面上依次是这 3 个功能的界面、操作、状态与通知，不需要再跳到功能页
