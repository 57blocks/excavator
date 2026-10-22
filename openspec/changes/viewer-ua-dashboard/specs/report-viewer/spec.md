## ADDED Requirements

### Requirement: UA 仪表盘副本

`/excavator-view` SHALL 在 `.excavator/view.html` 之外再写出 `.excavator/ua-view.html`：Understand Anything 仪表盘的副本，用本项目的产物填数据。

副本的来源与改动：
- 源码取自 Understand Anything 的 `packages/dashboard` 与它引用的 `packages/core` 模块，保留 MIT 许可声明与来源提交号；
- 只为离线改动以下几处，此外的界面、交互、主题与文案 MUST NOT 改：
  - 数据文件改为读页面内联的数据；
  - 源码改为读内联的源码；
  - 去掉令牌门；
  - 布局 Worker 内联；
  - 陈旧度在打包时算好。
- 页面 SHALL 是一个自包含的 HTML 文件，从磁盘直接打开即可使用，不需要 Node、网络或本地服务，打开后不发出任何网络请求。

填入的数据：
- SHALL 只改形状、不改内容：
  - 知识图谱的逐行记录拼回一个图；
  - 领域图、`meta.json` 原样；
  - 导览步骤放进图的 `tour`；
  - 源码按 `/excavator-view` 现有的内联规则，`--no-source` 时不内联。
- 缺少的产物 SHALL 落进副本自己的空状态（例如没有领域图时领域切换不可用），不得用编出的数据补齐；
- 副本的校验报告的问题（例如它不认识的边类型）SHALL 照副本自己的方式显示，打包回复写出问题条数。

#### Scenario: 不起服务就能看
- **WHEN** 打包一个有知识图谱、领域图与导览的项目，然后在浏览器里直接打开 `ua-view.html`
- **THEN** 结构图、层内视图、聚焦、领域图、代码查看器与 Learn 面板都能用，且页面没有发出网络请求

#### Scenario: 数据只改形状
- **WHEN** 打包一个项目
- **THEN** 页面里的节点、边、层、领域节点与导览步骤的条数和内容与产物里的相同

#### Scenario: 没有领域图
- **WHEN** 打包一个没有 `domain-graph.json` 的项目
- **THEN** 副本照它自己没有领域图时的样子显示，打包回复写明领域图 not run

#### Scenario: 旧查看器不变
- **WHEN** 打包任何项目
- **THEN** `.excavator/view.html` 与本变更之前打出的完全相同
