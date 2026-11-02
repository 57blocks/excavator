## Why

`excavator-prd-report` 按功能各写一章 As-Is PRD，写给产品经理：功能由代码入口自下而上归组，章节里有服务名、接口、路由、角色代码和证据块，问题只有功能内部的 product 与 technical 两类。现在需要的是另一种产物：一本面向**非技术读者**的整体产品手册，按读者在产品里看到的区域与菜单自上而下组织，每个功能的细节程度与 PRD 相当，并且讲清系统目前有哪些问题（功能、跨功能与系统层面，不只是 bug，也包括逻辑、操作、体验）。这是一个新功能，用来取代 `excavator-prd-report`；旧 skill 在新 skill 具备问题发现与报告页之后单独删除。

新功能按切片交付。本变更是第一片：产品地图、功能条目，以及可选语言的 HTML 导出。它先把「读者看到的产品」这条主干和「正文不含代码、每个值都有原文出处」这两道门立起来，后面的问题发现、语义核对、报告页都建在它们上面。

## What Changes

- **新 skill `excavator-product-handbook`**：本切片做三步。
  1. 脚本列出项目的入口候选（页面、路由、定时任务、`main`）。
  2. 模型写**产品地图**：区域 → 功能，每个功能标明读者从哪里到达它（菜单、链接、自动、对外接口、运维），菜单与链接上的名字引用源码原文；每个候选恰好属于一个功能，或进入可见的未归入清单。
  3. 每个功能一个子代理写**功能条目**（结构化 JSON：用途、谁能用、在哪里、页面与字段、前端与后端两侧的规则、操作与结果、状态、通知、自动行为、无法确定的内容），每一项带原文出处；脚本逐项核对后拼成一份 Markdown。
- **新脚本 `handbook.mjs`**：`candidates`、`check-map`、`check-entry`、`assemble`，以及记录每个功能状态的 `mark`。
  - 守恒：每个候选恰属一个功能或未归入，不成立则打印差集并退出 1。
  - 引文：每段引文在所引文件里恰好出现一次；所引文件必须是项目源码，不得在 `.excavator/`、依赖或构建目录里。
  - 值：条目里的每个界面标签、每个数字都必须出现在它自己的引文里。
  - 禁词：读者可见的文字里不得出现代码形状的词（下划线或驼峰标识符、以 `/` 开头的路径、文件扩展名、调用括号）和项目成员目录名；已经核对过的界面标签除外。
- **逐项核对**：条目通过脚本检查后，两名只看「主张 + 所引源码前后文」的核对子代理各自给每一项判词，两人都确认才算成立；不成立的项改写一次，仍不成立就删去并在手册里列出。之后一名能读全项目的追查子代理只找反证，被它指出与代码矛盾的项也删去并列出。真实运行的抽查里 30 项有 6 项与代码矛盾（引文都真实存在，错在解读），所以这一步从后续切片提前到本片。
- **`--features <ids>`**：只为指定的功能写条目，地图仍覆盖全部候选。
- **HTML 导出**：`handbook.mjs page` 把地图与条目写成一个 `handbook.html`，双击即可从磁盘打开，不联网、不需要服务器。页面按区域导航，有功能页与覆盖页。页面模板是新包 `packages/product-handbook-page`。
- **语言**：`--language` 选手册的语言（中文、英文或其他），默认英文。叙述、区域名和页面上的固定文字（标题、栏目名、表头）都用这种语言；源码里的界面标签保持原文。固定文字以英文表随 skill 发布；选了别的语言时由一个子代理翻译这张表，脚本核对键与占位符不变。
- **入口候选列表迁到新 skill**：`excavator-prd-report` 的入口列表脚本与模式目录移到 `skills/excavator-product-handbook/lib/`，旧 skill 改为从新位置引用，行为与输出不变。

**不做**（后续切片）：
- 问题发现（功能、跨功能、系统层）与问题排序。
- 把已写好的手册翻译成更多语言，并在同一个页面里切换语言（下一片）。
- 删除 `excavator-prd-report`。

## Capabilities

### New Capabilities

- `product-handbook`：产品地图（区域、功能、到达方式、候选守恒）、功能条目（结构与出处）、引文核对、值核对、禁词门、拼装与产物目录。

### Modified Capabilities

无。入口列表脚本换了位置，`excavator-prd-report` 的行为与产物不变。

## Impact

- 新增 `skills/excavator-product-handbook/`（`SKILL.md`、`handbook.mjs`、`lib/`、固定文字的英文表）与 `tests/skill/excavator-product-handbook/`。
- 新增 `packages/product-handbook-page/`（页面模板，构建方式与现有报告页相同：单文件、内联资源、数据由脚本填入），根目录 `package.json` 的构建与类型检查加上它。
- `skills/excavator-prd-report/lib/entrypoints.mjs` 与 `entrypoint-catalog.json` 迁出；旧 skill 的引用路径与 `tests/skill/excavator-prd-report/entrypoints.test.mjs` 跟着改。
- README 的 skill 列表加一行；安装测试里的 skill 计数加一。
- 不改事实层、MCP、runner 镜像与现有的 `packages/`。
