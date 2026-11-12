# learning-tour Specification

## Purpose
定义导览产物：一条 5–15 步的阅读路线，每步一段讲解、引用图谱里的几个节点，供查看页的 Learn 模式使用。节点由脚本给出的候选集限定，讲解由模型写，每一句由只看源码片段的子代理核验，被否定的句子不进产物，删掉的内容看得见。

## Requirements

### Requirement: 确定性候选集

`skills/excavator/tour.mjs candidates <projectRoot>` SHALL 不调用模型，从 `.excavator/` 下的图谱、语义缓存、语义图与领域图算出候选集，写到 `.excavator/tour/candidates.json`。候选 SHALL 包括：
- 入口候选：文件名是常见入口（如 `main.go`、`index.ts`、`app.js`、`server.js`、`main.py`），或位于成员仓根下一两级且扇出排在前 10%、扇入排在后 25% 的文件；
- 文件级扇入与扇出各前 20 名，按 `imports` 与 `calls` 边、聚到文件计数；
- 阅读顺序：每个成员仓（单仓即项目本身）各一条，从该成员仓里最像程序入口的代码文件出发，沿 `imports` 与 `calls` 正向广度优先，记深度。起点只从扇出至少为 1 的入口候选里取，按文件名分档：`main.*` 先于 `server.*`，再 `app.*`，再 `index.*`，最后是其它入口候选；同一档里目录层级浅的在前，再按扇出从高到低；
- 每层扇入最高的 5 个文件，层取语义图，没有语义图时取图谱的层记录；
- 领域图每个 flow 的 step 锚定节点（`nodeIds` 里图谱有的项），领域图的 `factDigest` 与图谱不同时不取；
- 非代码节点：`config`、`pipeline`、`service`、`document` 类型，按文件聚合。

每个候选 SHALL 带 `id`、`type`、`name`、`filePath`、`lineRange`、所在层、入选原因列表，以及摘要：摘要取语义缓存里打包时新鲜且结论不是 `contradicted` 的条目，没有就是空串，并带上核验结论。候选集 SHALL 写明各类的总数，以及每类因名额截掉了多少个。

#### Scenario: 被否定的摘要不进候选集
- **WHEN** 一个入选文件的语义条目新鲜、结论为 `contradicted`
- **THEN** 它的候选记录摘要为空串，结论写 `contradicted`

#### Scenario: 领域图对应别的修订
- **WHEN** 领域图的 `factDigest` 与图谱的 `factsDigest` 不同
- **THEN** 候选集里没有 flow 类候选，并写明领域图为 different revision

#### Scenario: 没有图谱
- **WHEN** `.excavator/knowledge-graph.jsonl` 不存在
- **THEN** 命令以非零退出，说明要先运行 `/excavator`

### Requirement: 导览的结构

模型写出的导览 SHALL 由 `tour.mjs check` 校验，不通过就退回给模型改，不写产物。规则：
- 5 到 15 步，`order` 从 1 起连续；
- 每步有 `title`（不超过 60 个字符）、`description`（2 到 5 句）、`nodeIds`（1 到 5 个不重复的 id），可选 `languageLesson`（不超过 3 句）；
- `nodeIds` 的每一项 SHALL 在候选集里。
- 标题、讲解与语言要点里 SHALL 没有建议或评价性措辞（如 should、recommend、consider、better to、needs to be improved 及 `--language` 所选语言里的对应说法）；`check` 列出命中的句子。

#### Scenario: 引用候选集外的节点
- **WHEN** 某一步的 `nodeIds` 含一个图谱里有、但候选集里没有的 id
- **THEN** `check` 失败并列出这一步与这个 id

#### Scenario: 讲解里有建议
- **WHEN** 某一步的讲解写着 "You should split this handler."
- **THEN** `check` 失败并列出这一句

#### Scenario: 序号有缺口
- **WHEN** 步的 `order` 是 1、2、4
- **THEN** `check` 失败并写明缺 3

### Requirement: 逐句核验

`tour.mjs slices` SHALL 把每步的标题作为一句，并把讲解与语言要点按句切开（句中的省略号不算句末），给每句一个 id，并为每步截取它引用节点的源码片段（节点的 `lineRange`；文件节点取开头一段，长度有上限，截断时写明）。核验子代理 SHALL 只收到一步的句子与这些片段，不收到候选集、其它步或模型的理由，对每句给出 `verified`、`unverified` 或 `contradicted` 之一与一句理由。

`tour.mjs verdicts` SHALL 检查每句都有结论，缺结论的句子记为 `unchecked`。有 `contradicted` 句子的步 SHALL 退回给模型改写一次，改写后整步重新切句、重新核验。第二次仍为 `contradicted` 的讲解与要点句子 SHALL 从产物里删掉；第二次仍为 `contradicted` 的标题 SHALL 换成这一步引用节点的名称（按 `nodeIds` 顺序以逗号连接，不超过 60 个字符），原标题记进 `removed`；删到讲解一句不剩的步整步去掉，余下的步重新编号。每一处删除 SHALL 记进产物的 `removed`，写明原步、原句、结论与理由。

#### Scenario: 改写后通过
- **WHEN** 第 3 步有一句第一次被判 `contradicted`，改写后各句都是 `verified`
- **THEN** 产物里第 3 步是改写后的文字，`removed` 里没有它

#### Scenario: 两次都被否定
- **WHEN** 第 3 步的一句两次都被判 `contradicted`，这一步还有别的句子
- **THEN** 产物里第 3 步没有这句，`removed` 有一条记录写明它

#### Scenario: 标题两次都被否定
- **WHEN** 第 4 步的标题两次都被判 `contradicted`，讲解各句通过
- **THEN** 产物里第 4 步的标题是它引用节点的名称，`removed` 有一条写明原标题、结论与理由

#### Scenario: 句中的省略号
- **WHEN** 一条语言要点写着 "a chain of if x == ... comparisons, each branch returning a handler."
- **THEN** 它被切成一句

#### Scenario: 整步被删空
- **WHEN** 第 5 步的讲解每一句两次都被判 `contradicted`
- **THEN** 产物里没有这一步，原第 6 步变为第 5 步，`removed` 写明原第 5 步的每一句

### Requirement: 导览产物

`tour.mjs report` SHALL 把导览写到 `.excavator/tour.json`，原子写入，同一输入写出逐字节相同的文件。产物 SHALL 包含：
- `format`（`excavator-tour/1`）、`contentLanguage`、`sourceRevision`、`factDigest`（等于图谱的 `factsDigest`）；
- `steps`：每步的 `order`、`title`、`description`、`nodeIds`、可选 `languageLesson`，以及每句的文字、结论与理由；
- `removed` 与 `gaps`（如步数少于 5、有 `unchecked` 句子）；
- `counts`：步数、句数（含标题）、各结论的句数、删掉的句数与步数、换成节点名称的标题数（`replacedTitles`）。

`unverified` 的句子 SHALL 保留在产物里并带着结论；`contradicted` 的句子 MUST NOT 出现在 `steps` 里。

#### Scenario: 步数少于 5
- **WHEN** 删除之后只剩 4 步
- **THEN** 产物照样写出 4 步，`gaps` 有一条写明步数少于 5

### Requirement: 回复与语言

skill 的报告与对用户说的每一行 SHALL 用英文写，除非 `--language` 给了别的语言；项目文件、记忆、源码或子代理回复的语言不改变它。导览的 `title`、`description` 与 `languageLesson` SHALL 用同一语言，`contentLanguage` 记下它。最后回复 SHALL 是最后一条命令打印的几行：产物路径、步数、各结论的句数、删掉的句数与步数，以及建议检查的命中行数，回复里不加别的内容。这几行的标签是产物的字段名，由脚本原样打印，不随 `--language` 翻译。

#### Scenario: 默认英文
- **WHEN** 没有给 `--language`，项目的 `AGENTS.md` 写着用中文回复
- **THEN** 导览与回复都是英文，`contentLanguage` 为 `en`
