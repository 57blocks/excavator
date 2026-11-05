## MODIFIED Requirements

### Requirement: 内嵌源码与它的可见分类

默认 SHALL NOT 内嵌源码：每个被引用的文件都归在 not embedded on request，页面里没有任何源码文本。打包时指定 `--source` 时，SHALL 内嵌知识图谱的文件节点，以及已放进页面的 unused-code、doc-map、hotspots 与领域图引用到的每个源文件的文本。文本取自当前源码快照（Git 仓与多仓取 HEAD，不读工作区）。`--no-source` 与默认相同；两者同时给出时以后出现的为准。

每个被引用到的文件 SHALL 落进且只落进下面一类，打包的结果 SHALL 给出各类计数：
- **embedded**：已内嵌文本；
- **binary**：不是文本，不内嵌；
- **too large**：超过单文件上限，不内嵌。结果给出上限（`limitBytes`）与这一类的计数，不记单个文件的大小；
- **not in snapshot**：当前快照里没有这个路径（例如产物版本较旧、文件已删除）；
- **not embedded on request**：打包时没有要求内嵌源码。

页面的代码查看器 SHALL 能打开每个已内嵌的文件。产物视图里带文件路径的行，文件已内嵌时 SHALL 能打开代码并定位到行；文件没有内嵌时，SHALL 写明这个文件的源码不在页面里。产物指向的行超出内嵌文本的行数时，代码查看器 MUST NOT 标出别的行。

#### Scenario: 不嵌源码
- **WHEN** 不带 `--source` 打包（默认，或只给 `--no-source`）
- **THEN** 文件里没有任何源码文本；每个被引用文件都归在 not embedded on request；产物视图的行详情写明源码不在页面里

#### Scenario: 显式内嵌
- **WHEN** 带 `--source` 打包
- **THEN** 被引用的文本文件按上面的分类内嵌，结果的 `requested` 为 true

#### Scenario: 从 unused-code 跳到源码
- **WHEN** 带 `--source` 打包后，在 Unused 视图里点一行，再点详情里的「打开代码」
- **THEN** 代码查看器打开该文件，并标出它的 `lineRange`

#### Scenario: 行号越界
- **WHEN** 产物记录的行号大于当前快照里该文件的行数，打开这一行的代码
- **THEN** 代码查看器打开该文件，不标出任何一行

### Requirement: /excavator-view skill

`/excavator-view [project-path] [--source] [--no-source] [--out <path>]` SHALL（`--source` 要求内嵌源码，默认与 `--no-source` 不内嵌，见「内嵌源码与它的可见分类」）：
1. 运行打包，写出 `explorer.html`；
2. 用系统默认浏览器打开写出的文件（macOS `open`、Linux `xdg-open`、Windows `start`）；没有可用的打开命令时，只给出文件路径，不算失败；
3. 最后用一条命令打印固定的五行作为回复，依次是：
   - `Explorer: <绝对路径>`
   - `Size: <MB，一位小数> MB`
   - `Issues: <N>`：副本自己的校验器在图里找到的问题条数；没有知识图谱时写 `Issues: not counted; knowledge graph <状态>`
   - `Products: knowledge graph <状态>; semantics <状态>; domain graph <状态>; unused code <状态>; doc map <状态>; hotspots <状态>; tour <状态>`
   - `Source: embedded (<N> files)` 或 `Source: not embedded`

`Explorer:` 是写出的路径，`Size:` 是写出文件的大小；`Issues:`、`Products:`、`Source:` 三行 SHALL 取自页面里打包写下的 manifest，所以回复说的就是页面里有的东西。

skill MUST NOT 启动 HTTP 服务，MUST NOT 运行任何分析，MUST NOT 改动 `.excavator/` 下除写出的页面以外的任何文件。没有任何产物时，它仍写出页面，并在回复里写明全部产物都是 not run。

#### Scenario: 只有 hotspots
- **WHEN** 项目只跑过 `/excavator-hotspots`
- **THEN** skill 写出并打开 `explorer.html`；回复的 Products 一行里 hotspots 为 included，其余为 not run；Issues 一行写明没有知识图谱、没有计数

#### Scenario: 指定输出路径
- **WHEN** 运行 `/excavator-view --out <dir>/page.html`
- **THEN** 回复第一行是 `Explorer: <dir>/page.html` 的绝对路径，打开的也是它
