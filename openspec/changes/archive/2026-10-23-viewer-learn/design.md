## Context

- Understand Anything（上游 `Lum1104/Understand-Anything`，读的是 b8c807c6）的 dashboard：
  - 顶栏 `PersonaSelector` 三个按钮 Overview / Learn / Deep Dive，对应 persona `non-technical` / `junior` / `experienced`；
  - Overview 在 `GraphView` 里滤掉 `function` 与 `class`；空闲侧栏是 `ProjectOverview`（描述、4 个统计格、类别与语言、类型分布条、复杂度、连接最多的节点、开始导览）；
  - Learn 的侧栏是 `LearnPanel`（未开始：步数与标题列表；进行中：第 N/总数、进度条、标题、Markdown 讲解、语言要点、引用节点、上一步/下一步），图用 `TourFitView` 移到这一步的节点，节点 `animate-accent-pulse`；
  - 领域图存在时顶栏有 Domain | Structural 分段按钮；
  - `NodeInfo`：返回与历史、类型与复杂度徽章、衬线名称、聚焦、摘要、文件与行、打开代码、标签、「本文件定义的」、连接列表；
  - 视觉：DM Serif Display 标题、Inter 正文、JetBrains Mono；`rounded-lg`/`rounded-xl` 卡片、玻璃浮层（blur 12–16px）、3% 噪点；动效只用 CSS（`fadeSlideIn` 8px 0.3 s、`slideUp` 0.3 s、`accentPulse` 2 s），fitView 400–500 ms。默认深色主题。
- 查看页现状（viewer-app，`packages/report-view`）：
  - 左侧导航 8 项（Graph、Domain、Overview、Unused code、Doc map、Hotspots、Code、Reports）；图上有 hotspots、unused、doc-map 叠加层；
  - 侧栏 `NodeDetails` 有「产物事实」一节，但只有几项数字，没有到详情页的链接；
  - 详情页由 `Page`、`Card`、`Tile`、`DataTable` 拼成，像卡片里的表格；只有 Doc map 有行详情面板；
  - 已有 motion 预设（`lib/motion.ts`）与 57blocks 浅色 token；字体写了 Geist 但没内联，实际是系统字体。
- 数据（go-multirepo）：图谱、语义、领域图、unused、hotspots 齐全；doc-map 没跑；导览由 tour-product 产出。

## Goals / Non-Goals

**Goals**
- 三种模式、Domain | Structural 切换、项目总览与导览面板，行为照 Understand Anything。
- 节点详情里直接看到产物数据，并能跳到详情页的那一行。
- 详情页达到 Understand Anything 的视觉层次，并有进场、面板与数字动效。

**Non-Goals**
- 不做深色主题、主题选择器、多语言界面、首访引导浮层、diff 叠加、导出菜单。
- 不做每个节点的「语言要点」（没有数据，见 tour-product 的 Non-Goals）。
- 不引图表库：需要的图只有条形、面积与小型柱状，SVG 手写即可。

## Decisions

### D1 模式

`mode` 是 hash 参数（`overview` | `learn` | `deep`），默认 `learn`（与 Understand Anything 一致），只作用于图页（结构图与领域图）。

| 模式 | 结构图节点 | 空闲侧栏 |
|---|---|---|
| Overview | 隐去 function 与 class；文件不再能展开出函数与类 | 项目总览 |
| Learn | 全部 | 导览面板；没有导览产物时写明导览未生成，并给出 `/excavator-tour` 命令 |
| Deep dive | 全部 | 项目总览 |

隐去的节点仍可搜索：搜索命中 function 或 class 时，切到 Deep dive 再定位，并在侧栏写明切换了模式。计数与下钻统计不受模式影响。

### D2 Domain | Structural

图页顶部浮层里的分段按钮，只在领域图可读时出现；切换走 hash（`#/graph` 与 `#/domain`），两边各自保留下钻位置。左侧导航的 Graph 与 Domain 两项保留，指向同样的路由。

### D3 项目总览

`ProjectOverview` 组件，内容依次是：
- 项目名（衬线）与描述（领域图 `project.description`，没有就不显示这一行）；
- 统计格：节点、边、层、文件；
- 语言与框架药丸（图谱 header 的 `project.languages` 与 `frameworks`）；
- 节点类型分布条、复杂度分布条（simple / moderate / complex）；
- 连接最多的 5 个节点（入边加出边），点击选中；
- 层列表（名称、文件数），点击下钻；
- 产物要点：未使用函数总数与按可信度的条，最热的 3 个文件；每项跳到详情页。产物没跑的写 not run；
- 有导览时一个「开始导览」按钮，切到 Learn 并开始第 1 步。

### D4 导览面板

`LearnPanel` 三种状态照 Understand Anything。进行中的一步：
- 讲解逐句显示；`unverified` 的句子末尾有一个小标记，悬停说明「源码片段里看不出真假」；
- 语言要点框；
- 引用节点药丸，点击选中并打开侧栏的节点详情；
- 产物里的 `removed` 不显示在步骤里，但面板底部写明「核验删掉了 N 句」，可展开看原句与理由。

图的配合：进入一步时切到这些节点所在的层并下钻到包含它们的最深公共容器，镜头 fitView 500 ms，节点外圈脉动（减少动效时改为静态描边）。`←`/`→` 切步，`Esc` 退出导览。步号写进 hash（`tour=<n>`），后退可回到上一步。

导览产物状态为 different revision 时面板写明，不显示步骤：步骤里的 id 可能已对不上。

### D5 节点详情与跳转

`NodeDetails` 改为：
- 标题区：类型与复杂度徽章、衬线名称、所在层；侧栏有自己的后退与前进（选中历史，最多 50 个），与浏览器后退并存；
- 「本文件定义的」：文件节点列出 `contains` 指向的函数与类，带复杂度，点击选中；
- 产物事实分卡片显示：
  - Hotspots（文件）：提交、作者、增加与删除行、分数及其在全部文件中的排名、最近修改日期、一起改最多的 3 个文件（`pairs` 里 `together` 最大的），按钮「在 Hotspots 中打开」；
  - Unused（函数）：原因、可信度、信号列表、所在组与组的入口、引用者（可点），按钮「在 Unused 中打开」；
  - Doc map（文件）：引用它的单元标题，按钮「在 Doc map 中打开」；
  - 产物没跑写 not run，跑了但这个节点不在其中写「不在列表里」。
- 容器与层卡片：叠加层打开时，卡片上显示该范围的汇总（如「未使用 37」「最热文件 12 个」），侧栏显示同样的数，按钮跳到按路径前缀过滤的详情页。

详情页路由新增 `row=<key>` 与 `prefix=<path>`：`#/unused?row=<nodeId>`、`#/hotspots?view=files&row=<path>`、`#/docmap?row=<单元序号>`（单元 id 可以为空或重复，序号与 checks、coverage 用的一致）。进入时表格跳到这一行所在的页、滚动到它、短暂高亮，并打开行详情面板；找不到这一行时写明。

### D6 详情页

共用组件：
- `PageHeader`：衬线标题、一行说明、产物状态徽章与快照信息；
- `StatTile`：数字滚动（已有），加上方小标签与下方一行说明；
- `BarList`（横向条形，带数值）、`AreaSpark`（逐年面积图）、`Histogram`（分数分布）：SVG，入场时条形从 0 生长，减少动效时直接画终态；
- `RowPanel`：右侧滑入的详情面板，复用 `Panel` 的玻璃样式与进出动画；
- 表格行首屏依次进场（最多 12 行，30 ms 间隔），行悬停上浮 1 px 加阴影；分页与排序切换时内容淡入。

各页：
- **Unused**：顶部统计格（总数、unreferenced、only-reachable、test-only），按可信度与按语言的 `BarList`，决定与残余假设折叠成卡片；表格行点开 `RowPanel`：字段、信号、所在组及组内其它成员、引用者、源码预览（`CodeView` 高亮行范围）、在图中定位。
- **Hotspots**：统计格、逐年提交 `AreaSpark`、分数 `Histogram`、最热 10 个文件的 `BarList`；Files / Directories / Pairs / Groups 为分段切换；文件行的 `RowPanel`：数字、逐年提交（有 `commitsByYear` 时）、一起改的文件列表、在图中定位、打开代码。
- **Doc map**：保留现有面板，换成同样的页头、统计格与条形。
- **Code**：文件树卡片加类别计数条；打开的文件上方显示它的节点与产物事实摘要（复用 D5 的卡片），可跳到图。
- **Reports**：报告列表成卡片，Markdown 正文用衬线标题层级。
- **Products**（原 Overview 页）：产物状态改为卡片网格，每张卡一个产物（状态、关键数字、跳转），其后是原有的计数表。

### D7 字体与视觉

`@fontsource/*` 的拉丁子集 woff2 由 vite 内联为 data URI；`font-display: block`，离线首屏即为正确字体。token 增加 `--font-heading`；标题、节点名、面板标题用衬线。背景加 3% 噪点（内联 SVG）。阴影、圆角与玻璃沿用 viewer-app 的 token，卡片的层次照 Understand Anything（层卡片左侧色条、悬停「点击展开 →」）。

### D8 打包

`products.mjs` 新增导览产物：读 `.excavator/tour.json`，`format` 不是 `excavator-tour/1` 为 unreadable，`factDigest` 与图谱不同为 different revision，否则 included；载荷原样只留 `steps`、`removed`、`gaps`、`counts`、`contentLanguage`。导览是产物之一，`reply.mjs` 的 Products 行加上它的状态：规范「/excavator-view skill」的回复列出每个产物的状态，不为导览开例外。

### D9 改名

左侧导航与路由 `#/overview` 改为 `#/products`；旧路由重定向到新路由，书签仍可用。

### D10 图的视觉照 Understand Anything

用户看过后说「图也没有 UA 好看」。逐元素对比（UA 源码 b8c807c6 与本包）的结论：差距主要在布局（顶层退成网格、直线穿过卡片）、卡片内容（没有类型标签、复杂度、摘要、衬线名称）、选中行为（不淡化无关卡片）与配色（所有层同一色条、边是灰的、箭头大）。UA 是 MIT 许可，节点组件可以移植，文件头保留版权与许可声明，模板开头的许可清单写上它。

UA 的深色值换成浅色时，取它自己的 `light-minimal` 预设的推导规则（边框、边、点阵都是强调色的透明度），强调色用 57blocks 的 `#6a4dff`。UA 在浅色下仍用的深色阴影与写死的金色不照搬，换成下表的浅色值。

| 元素 | 目标 |
|---|---|
| 布局 | ELK `layered`，结构图 `DOWN`、领域图 `RIGHT`，`nodeNode 60`、`nodeNodeBetweenLayers 80`，`padding` 上 40、其余 20；去掉 `rectpacking` 网格退路 |
| 层卡片 | 宽 300、`rounded-xl`、左侧 6px 色条取层色；先是层色的「LAYER」小标签（10px 大写），右侧是复杂度汇总与搜索命中数；衬线名称 18px；11px 两行描述；「N files」；悬停淡入「Click to explore →」 |
| 层色 | UA 的 7 色 `LAYER_PALETTE` 按层序循环，用于色条、标签与传送卡的圆点 |
| 文件、函数、类卡片 | 180–220 宽、`rounded-lg`、左侧 4px 类型色条；上方类型标签（类型色、10px 大写）与复杂度（9px mono：simple 绿、moderate 强调色、complex `#c97070`）；衬线名称 14px；两行摘要（`contradicted` 的不显示）。文件卡仍可展开出函数与类 |
| 文件夹容器 | 层内按目录的框，原地展开（不再是新的一级）：边框 1px 强调色 .25，展开时 1.5px .6；衬线 14px 名称取层色；右侧计数；每次展开仍受每级 400 个节点的上限，超出折叠 |
| 传送卡 | 层内视图里，与本层相连的其它层各一张虚线卡（2px 虚线、层色 .4），写「N connections」，点击进入那一层；从相连的卡片画 1px 虚线边 |
| 卡片边框与阴影 | 边框强调色 .1；阴影：卡片 `0 2px 8px rgb(12 12 18/.08)`，层卡片 `0 4px 16px rgb(12 12 18/.10)` |
| 连接点 | 可见，8px，`muted` 色 |
| 边 | 贝塞尔，强调色 .4，宽 `min(1+log2(n+1), 5)`；聚合边不画箭头（它是双向计数），展开后的文件间边画 10px 小箭头 |
| 边标签 | 计数常显，11px 600、`muted` 色、白底；按长度从长到短放置，与已放下的标签或任何卡片相交的就不画，悬停时总能看到这条边的标签（承接 viewer-app 修复后的规则：可见标签两两不相交、都在卡片之上） |
| 选中 | 选中卡片外发光 `0 0 20px rgb(106 77 255/.15)` 加 2px 强调色描边；非邻居卡片淡到 .2，邻居 1px 强调色 .5 描边；相连的边强调色 .8、2.5px、流动虚线动画；其余边 .08、1px |
| 搜索 | 命中卡片按得分描边（最好 2px 亮强调色、次之 2px 强调色、其余 1px 强调色 .6）；层卡片「N matches」、容器「N hits」 |
| 画布 | 点阵强调色 .15、间距 20、大小 1；MiniMap 白色节点、底色 paper、遮罩白 .8 |
| 面包屑 | 左上角胶囊 `rounded-full`、12px 大写 600、`shadow-lg`；层内写「PROJECT › 层名 (Esc to go back)」 |
| 领域卡片 | `border-2` 强调色 .4、底色比画布深一档、悬停 .7；选中强调色边与 .1 底；衬线强调色名称；两行摘要；「ENTITIES」与最多 5 个实体药丸加「+N」；「N flows」 |
| flow 与 step 卡片 | flow 240–320 宽，入口点 9px mono 强调色、名称、摘要、「N steps」；step 180–240 宽，序号、名称、摘要、文件路径 |
| 跨领域边 | 强调色、虚线 `6 3`、2px、流动动画、不画箭头；描述标签常显，放置规则同边标签 |
| 动效 | 层级切换 fitView 400 ms、选中 fitView 500 ms；流动虚线与淡化在减少动效时关闭（淡化改为直接切换） |

连线与卡片交叉（用户：「聚焦一个 card，会出现很多线和 card 交叉，感觉有点乱」）。查明有三个原因，都在这条决定里改：
- **网格不看边。** 密的一级（`graph-layout.ts` 判定「边多到分层会排成一条长链」）退到 `rectpacking` 网格，按条目顺序排行，相连的卡片可能隔着好几行；
- **边是中心对中心的直线。** `FloatingEdge` 用 `getStraightPath` 从一张卡片的边框连到另一张，途中经过的卡片一概不避；
- **聚焦视图用力导向。** 邻居绕着中心散开，进来的边与出去的边混在一起，直线互相穿过邻居卡片。

改法：
- 每一级都用 ELK `layered`，去掉网格退路；密的一级交给 ELK 自己的换行（`wrapping`）与更宽的画布，而不是网格；
- 边的路径用 ELK 布局返回的走线（`sections` 的起点、拐点、终点）画成平滑曲线，连接点在卡片的上下边；ELK 分层时就把边放在层与层之间，并尽量减少交叉；
- 聚焦视图改为分层：选中的节点在中间一层，指向它的邻居在上一层，它指向的邻居在下一层，两边都有的放在上一层；同一层按名称排序；
- 可量的目标：「边穿过非端点卡片」的条数。验收在 go-multirepo 的顶层、两个层内视图与 3 个聚焦视图上各数一次，改前改后都记下；改后每个视图为 0，或逐条写明 ELK 为什么没能绕开。

这条决定改写 viewer-app 的两处行为，规范里一并改：顶层不再退成网格；文件夹在层内原地展开，下钻的层级只剩「项目 → 层 → 层内展开」。下钻计数（路径前缀计数）、400 上限与「折叠只折叠不丢」三条规则不变，只是落在展开的框上。

## Oracles

验收只用 go-multirepo（用 tour-product 在克隆上产出的 `tour.json`）。

- **O1 单测**，每条先用注入变异证明会红：模式对节点的过滤与计数不变；搜索命中隐去节点时切模式；导览步骤到最深公共容器；`tour=` 与 `mode=`、`row=`、`prefix=` 的 hash 往返；产物事实的取数（排名、一起改的前 3、组的入口）；旧路由重定向；打包的导览四种状态；字体与噪点在模板里且无外部请求。
- **O2 全量门**：同 viewer-app。
- **O3 冒烟**：夹具包带一份导览，`view-smoke-graph.mjs` 新增场景：三种模式、Domain | Structural、导览走完、节点产物事实跳到详情页并打开行面板、减少动效；所有悬停用真实指针事件（CDP `Input.dispatchMouseEvent`），先证明装置在旧代码上会红。
- **O4 go-multirepo**：
  - Overview 模式顶层与 3 个下钻层里没有 function 与 class 节点，文件计数与 Deep dive 相同；
  - 导览：步数、每步引用节点被选中并可见、`unverified` 标记数等于产物里 `unverified` 句数、「删掉 N 句」等于 `counts`；
  - 产物事实：3 个 hotspots 文件与 3 个 unused 函数，侧栏数字与独立 jq 计算相等（含排名与一起改的前 3）；点「在…中打开」后详情页选中的行等于该记录，面板打开；
  - 容器汇总：2 个容器的未使用数与路径前缀的 jq 计数相等，跳转后表格行数相等；
  - 耗时、大小（含字体增量）、动效与减少动效、无外部请求与控制台错误；
  - 图的视觉（D10）：在顶层、一个层内、一个展开的文件夹与领域顶层，用计算样式核对 D10 表里可量的值（布局方向与间距、卡片宽度与圆角、色条宽度与层色、边宽上限、点阵颜色、选中时非邻居不透明度 .2）；可见边标签两两不相交且都不压卡片；卡片两两不相交；
  - 截图（1280 宽）：三种模式各一张、导览进行中、节点详情含产物事实、Unused 页加行面板、Hotspots 页加行面板、Products 页、层内带传送卡与展开的文件夹、领域顶层；768 宽一张。由我对照 D10 的表与 Understand Anything 的版式逐项判断。
- **O5 skill 真实运行**：同 viewer-app。

## Risks / Trade-offs

- **[模板变大]** 字体约 150–250 KB。→ 只取拉丁子集与用到的字重（Inter 400/500/600、JetBrains Mono 400/600、DM Serif Display 400）。
- **[模式隐去节点让人以为数据少了]** → 计数不随模式变，Overview 模式的图上写明「函数与类已隐去」。
- **[导览 id 与图不对应]** → different revision 时整份不显示，不逐条猜。
- **[详情页与图的跳转形成循环]** → 跳转都走 hash，后退回到原处。

## 归档记录（2026-10-23）

**交付范围**：第 1–4 片，commit `ad8755cf`（打包导览、Overview 页改名 Products）、`0b007ed1`（内联字体与共用组件）、`efbd6269`（详情页的统计、分布、行面板与行链接）、`1aea474c`（三种模式、Domain | Structural、项目总览，含表格页居中），随 PR 77 合入 main。验证见 tasks.md 第 1–4 节与第 8 节。

**没做的部分**：
- 第 6 片（导览走步面板）与第 7 片（图的视觉）：用户改为整份复制 Understand Anything 的仪表盘（变更 viewer-explorer），`explorer.html` 的副本自带分层布局、层卡片与导览，不再在 `view.html` 上重做。
- 第 5 片（节点详情里的产物事实与跳转）：没有做，`explorer.html` 上也还没有；explorer-products 的 Non-Goals 已写明留给以后的变更。
- Learn 模式的空闲侧栏因此只显示导览的状态与各步标题，「开始导览」只切到 Learn 模式，不进入第 1 步。

**规范的取舍**：delta 删去「导览面板」「图的视觉」两条 ADDED，以及「结构图」「节点详情与代码抽屉」「快捷键与返回」三条 MODIFIED（这三条的改动属于第 5–7 片，主规范保留原文）。「三种模式」与「项目总览」改写成已实现的行为（Learn 的空闲侧栏、「开始导览」），「Overview 模式」场景不再提层内文件夹。Oracles 里第 5–7 片的部分（导览、产物事实、D10 的视觉核对、对应截图）没有执行。
