## ADDED Requirements

### Requirement: 离线仪表盘的产物视图

`explorer.html` SHALL 显示 unused-code、hotspots、doc-map 三个产物：

- 顶栏：
  - MUST NOT 显示文件与类的切换（以及类视图里的函数开关）和节点类型过滤标签；结构图按文件级显示全部节点类型；
  - 在原来的位置 SHALL 显示 Unused、Hotspots、Doc map 三个按钮，样式与 Domain | Structural 切换相同，当前打开的那个高亮。
- 视图：
  - 点一个按钮，中间区域 SHALL 换成该产物的视图；再点同一个按钮，或点 Domain / Structural，SHALL 回到图，图的位置、层级与选中的节点不变；
  - 视图的内容 SHALL 满足「Unused code 页」「Doc map 页」「Hotspots 页」三条要求，「产物内容只当文字」同样适用，MUST NOT 出现建议性措辞；
  - 版式 SHALL 用浏览页自己的主题颜色、字体与卡片样式，随浏览页的主题切换。
- 行详情：
  - 点表中一行，右侧栏 SHALL 显示这一行的详情：unused 的字段、信号、分组成员与引用者；hotspots 文件行的字段、逐年提交与同改文件；doc-map 单元的引文、证据位置与核验结论；
  - 行指向的节点在图里时，详情 SHALL 有「在图中显示」：回到结构图并选中该节点；不在图里时写明不在图里；
  - 行有源码位置且源码已内联时，详情 SHALL 有「打开代码」，用浏览页的代码查看器打开该文件并定位到行；源码没有内联时写明。
- 产物状态：
  - 产物 not run 或 unreadable 时，视图 SHALL 写出状态与原因，not run 时给出产生它的命令；MUST NOT 用编出的数据补齐；
  - 产物与打包时源码快照的版本不同时，视图顶部 SHALL 写出两个版本，内容照常显示。
- 页面 MUST NOT 显示首次打开的引导弹窗。

打包 SHALL 把这三个产物的文件（doc-map 连同 `doc-map/checks.json`）原样放进页面数据，并为每个写出状态（included、not-run、unreadable、different-revision）、原因与版本；状态不是 included 或 different-revision 的，不放内容。

#### Scenario: 顶栏换成三个产物入口
- **WHEN** 打开一个有知识图谱的项目的 `explorer.html`
- **THEN** 顶栏没有 Files、Classes 按钮和 Code、Config 等过滤标签，有 Unused、Hotspots、Doc map 三个按钮；不出现引导弹窗

#### Scenario: 打开 Unused 再回到图
- **WHEN** 在结构图里选中一个节点后点 Unused，按置信度只选 high，再点 Unused
- **THEN** 中间显示 Unused 视图，列出的条数等于 `counts.byConfidence.high`；回到图后同一个节点仍被选中

#### Scenario: 从行详情回到图
- **WHEN** 在 Hotspots 视图点一个文件行，再点详情里的「在图中显示」
- **THEN** 中间回到结构图，该文件的节点被选中，右侧栏显示它的节点详情

#### Scenario: 产物没跑
- **WHEN** 项目没有 `doc-map.json`，点 Doc map
- **THEN** 视图写明 Doc map 是 not run，并给出 `/excavator-doc-map`；不显示任何单元或计数
