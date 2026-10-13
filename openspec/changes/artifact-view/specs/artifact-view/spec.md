## Purpose

定义静态自包含查看器产物 `view.html` 的契约：谁都能用浏览器直接打开；按 `.excavator/` 里实际存在的产物渲染且缺失可见；语义按项标新鲜度；大图不炸、裁剪可见；源码嵌入可选；烘焙自检通过后才写出。

## ADDED Requirements

### Requirement: 单文件自包含且零依赖

烘焙 SHALL 把页面与数据写成恰好一个 HTML 文件，默认路径为 `<project>/.excavator/view.html`。该文件 SHALL 能以 `file://` 直接打开并完整工作，MUST NOT 依赖网络、本地 HTTP 服务、Node 或任何已安装的工具链。文件 MUST NOT 引用任何外部资源（脚本、样式、字体、图片、动态加载的代码分块），并 SHALL 声明禁止网络访问的内容安全策略：除内联脚本与样式、`data:` 图片、`blob:` Worker 之外不允许任何来源。

#### Scenario: 离线双击打开
- **WHEN** 把 `view.html` 复制到没有 Node、没有网络的机器上用浏览器打开
- **THEN** 总览、结构、图谱、覆盖与缺口、搜索全部可用，浏览器控制台没有资源加载失败或脚本错误

#### Scenario: 没有外部引用
- **WHEN** 检查烘焙输出里所有 `src`、`href`、`url()` 与 `import` 的目标
- **THEN** 没有任何 `http:`、`https:`、协议相对或相对路径的外部资源，内容安全策略声明存在且禁止网络来源

### Requirement: 按产物清点渲染，缺失可见

烘焙 SHALL 清点 `.excavator/` 里存在的产物并把清点结果写进页面。`knowledge-graph.jsonl` 与 `source-manifest.json` 为必需，缺任一则烘焙以具名错误失败并提示运行 `/excavator`。`fingerprints.json`、`source-index.jsonl`、`semantic-cache.json`、`semantic-graph.json`、`domain-graph.json` 为可选：存在则嵌入并渲染对应区块；缺失则对应区块 SHALL 明示「未生成」并给出生成它的命令，MUST NOT 静默隐藏，也 MUST NOT 用占位内容冒充。页面 SHALL 只依据清点结果决定渲染，不区分 Lazy 与 Full 模式。

#### Scenario: 只有 Lazy 产物
- **WHEN** 数据目录只有 Lazy 首跑的产物
- **THEN** 事实区块全部渲染；摘要、architecture layers、领域流三处显示「未生成」，并分别给出 `/excavator --mode=full` 与 `/excavator-domain`

#### Scenario: 部分节点有缓存摘要
- **WHEN** `semantic-cache.json` 只含少数节点的条目
- **THEN** 这些节点显示摘要与标签，其余节点显示「未摘要」，区块不因覆盖不全而隐藏，清点区块给出有摘要的节点数与总数

#### Scenario: 必需产物缺失
- **WHEN** 数据目录没有 `knowledge-graph.jsonl`
- **THEN** 烘焙以具名错误失败，不写出任何文件，提示先运行 `/excavator`

### Requirement: 逐项新鲜度

页面 SHALL 按项标注新鲜度，不做整页的二分：语义缓存每条按 `semanticSourceHash` 与 manifest 中该文件的 `contentHash` 比对标新鲜或过期；`semantic-graph.json` 按其 `factDigest` 与图 header 的 `factsDigest` 比对；`domain-graph.json` 按 `sourceRevision` 与 manifest、`factDigest` 与 header 比对。过期的内容 SHALL 仍然显示并标为过期。烘焙 SHALL 用共享的消费端新鲜度助手判定事实层相对当前源码的状态（fresh / stale / missing），写进页面并在终端报告；stale 时烘焙继续，页面顶部与终端都提示重跑 `/excavator`。

#### Scenario: 缓存条目过期
- **WHEN** 某节点所在文件的 `contentHash` 与其缓存条目的 `semanticSourceHash` 不同
- **THEN** 该节点的摘要显示并标为过期；同一文件里 hash 一致的条目标为新鲜

#### Scenario: 语义图过期
- **WHEN** `semantic-graph.json` 的 `factDigest` 与 header 的 `factsDigest` 不同
- **THEN** layers 区块整块标为过期并仍可浏览，提示重跑 `/excavator --mode=full`

#### Scenario: 事实层过期
- **WHEN** 当前源码 revision 与 manifest 的 `sourceRevision` 不同
- **THEN** 烘焙仍写出文件，页面顶部与终端都显示数据对应的 revision、当前源码已变化，以及运行 `/excavator` 刷新的提示

### Requirement: 规模预算与具名失败

烘焙 SHALL 逐行流式读取 JSONL，MUST NOT 把整图实例化为对象，MUST NOT 把整份数据拼成单个字符串，运行内存 SHALL 只随输出增长。嵌入数据 SHALL 是字符串驻留的列式形式。header、节点、边、覆盖、缺口 SHALL 总是嵌入。证据行原文与符号源码片段 SHALL 受预算约束（默认值在设计中给出，`--source-budget` 可改），超预算时按固定顺序裁剪：先去符号源码片段，仍超预算再去证据行原文。每次裁剪 SHALL 在终端与页面的清点区块明示。嵌入数据超过硬上限时 SHALL 以具名错误失败，错误给出产物名、所需字节数与上限，且 MUST NOT 写出任何文件。

#### Scenario: 大图烘焙
- **WHEN** 对节点数十万、边数近百万的图（如 hadoop 语料）烘焙
- **THEN** 烘焙成功，输出文件远小于 JSONL，页面打开后总览可见，解码后的节点与边计数等于 header

#### Scenario: 预算触发裁剪
- **WHEN** 以很小的 `--source-budget` 烘焙一个带证据与源码片段的图
- **THEN** 源码片段先被去掉，仍超预算时证据行原文被去掉；终端与页面清点区块列出被裁剪的项；header、节点、边、覆盖、缺口完整

#### Scenario: 超过硬上限
- **WHEN** 嵌入数据超过硬上限
- **THEN** 烘焙以具名错误失败并给出所需字节数与上限，目标路径上没有新文件，已有的旧 `view.html` 逐字节不变

### Requirement: 烘焙自检后才写出

烘焙 SHALL 在写出前核对：流式读出的节点、边、缺口计数等于 header 计数；嵌入数据能被模板侧的解码器解出并得到相同计数；输出不含外部引用且含内容安全策略。任一核对失败 SHALL 以具名错误失败并不写文件。写出 SHALL 原子进行：先写临时文件再改名替换。页面 SHALL 显示自己从嵌入数据解出的计数，与清点区块里的 header 计数并列。

#### Scenario: 截断的图谱
- **WHEN** `knowledge-graph.jsonl` 的实际记录数少于 header 声明
- **THEN** 烘焙以具名错误失败并报告差异，不写出文件

#### Scenario: 页面计数自报
- **WHEN** 打开任一烘焙页面
- **THEN** 清点区块同时显示 header 计数与解码后的计数，两者相等

### Requirement: 源码嵌入可选

默认烘焙 SHALL 嵌入每条证据的行原文与每个带 `lineRange` 的节点的源码片段，来源为与 manifest 一致的源码快照；源码快照与 manifest 不一致的文件 MUST NOT 嵌入，并在清点区块按数量明示。`--no-source` 时 MUST NOT 嵌入任何源码原文，证据保留文件与行号，页面在原文位置显示「未嵌入源码」。嵌入的源码片段 SHALL 以节点的 `lineRange` 为界，MUST NOT 嵌入 manifest 之外的文件。

#### Scenario: 默认嵌入
- **WHEN** 默认烘焙后在页面选中一个函数节点
- **THEN** 详情显示该函数行范围内的源码，以及每条出边的证据行原文

#### Scenario: 不嵌源码
- **WHEN** 以 `--no-source` 烘焙，源码中含一个只出现一次的标记串
- **THEN** 输出文件中不含该标记串；详情里证据只有文件与行号并标「未嵌入源码」

### Requirement: 拖入数据目录

页面 SHALL 接受用户拖入或选择的 `.excavator/` 目录，用与烘焙相同的清点规则与解析器渲染；对同一份数据，拖入与烘焙 SHALL 得到相同的清点结果与计数。拖入的数据 MUST NOT 离开浏览器。拖入路径没有源码快照，源码原文一律显示「未嵌入源码」。

#### Scenario: 拖入目录
- **WHEN** 把一个只含 Lazy 产物的 `.excavator/` 目录拖进页面
- **THEN** 页面渲染与对同一目录烘焙后打开相同的区块、相同的计数与相同的「未生成」标注

### Requirement: 探索与定位

页面 SHALL 支持按名字、路径与 id 搜索节点，并支持用 source-index 的词项检索标识符；选中节点 SHALL 显示其事实字段、按类型分组的出入边与每条边的证据；页面状态 SHALL 写入 URL 片段，使带片段的链接打开后定位到同一节点或视图。图谱视图 SHALL 按目录聚合渲染，只在展开的范围内渲染符号级节点，MUST NOT 一次渲染全部符号节点。

#### Scenario: 深链接
- **WHEN** 用带节点 id 片段的 URL 打开页面
- **THEN** 页面定位到该节点并打开详情

#### Scenario: 节点详情
- **WHEN** 选中一个类节点
- **THEN** 详情列出 id、路径、行范围、owner、complexity，以及 contains、calls、imports、exports、inherits、implements、mentions、references、injects 中每类存在的边的对端与证据行

#### Scenario: 大图聚合
- **WHEN** 打开 hadoop 规模的烘焙页面并进入图谱视图
- **THEN** 首屏只画目录级聚合节点与聚合边，展开一个目录后才画其中的文件与符号

### Requirement: view skill 的行为

`/excavator-view` SHALL：确认 `.excavator/knowledge-graph.jsonl` 存在，否则提示运行 `/excavator` 并停止；用共享的新鲜度助手判定并提示；模板缺失时先构建；运行烘焙；报告输出路径、文件大小、嵌入的产物清单、被裁剪的项与新鲜度状态；默认用宿主的系统打开器打开文件，`--no-open` 时只打印路径。skill MUST NOT 调用模型，MUST NOT 修改 `.excavator/` 里除输出文件之外的任何产物，MUST NOT 起常驻进程或监听端口。

#### Scenario: 正常打开
- **WHEN** 在已分析的项目里运行 `/excavator-view`
- **THEN** 写出 `.excavator/view.html`，终端报告路径、大小、清单与新鲜度，文件交给系统默认浏览器打开，skill 结束后没有残留进程

#### Scenario: 没有图谱
- **WHEN** 在未分析的项目里运行 `/excavator-view`
- **THEN** 提示先运行 `/excavator`，不写出文件
