## Context

`unused-code` 已归档。它的验收运行在会话内的 Sonnet 子代理里完成；之后两轮审读的修正（测试代码、程序启动、`medium` 措辞、`calls` 为 0 的语言），只做了契约测试与产物重放，没有用真实模型重跑。这次用 headless `claude -p`（`--model sonnet`，即 `claude-sonnet-5`；上限 $15；串行）在 Fineract 与 dataverse 的副本上重跑。每次运行后用确定性脚本与修正前的产物对比：
- 启动候选有没有判；
- 测试代码有没有记成 `entry`；
- 决定 id 的重合度；
- 各状态之间的迁移；
- `high` 是否一致；
- 最终汇报的措辞；
- 项目文件有没有改动。

## Goals / Non-Goals

**Goals:**
- 让测试代码、程序启动与汇报措辞三条规则在真实运行里守住。
- 能确定检查的，放进 skill 的决定脚本；不能检查的，给出清单命令，写在模型动手的步骤里。

**Non-Goals:**
- 不改 `unused-code.mjs`，不加框架或语言分支。
- 不追求两次运行的入口决定一致。重合度见验收记录；差异只落在 `low` / `medium`，`high` 每次都一致。
- 不为 `calls` 为 0 的语言（目前是 shell）补调用事实。

## Decisions

- **D1 测试代码写成路径正则。**
  - 规格按代码所在位置定种类，所以测试代码是文件路径的性质。正则比任意 `jq` 条件简单，也更难写错。
  - 决定脚本把它包成 `jq` 函数 `test_code`，查询里可以直接用。
  - 记录下的查询在前面带上这个定义，单独重跑选出同样的 id。`report` 不读查询，决定文件格式不变。
- **D2 拒绝，不警告。**
  - 散文规则已经被跳过两次；警告同样可能被跳过。拒绝会逼模型把决定拆开。
  - 代价：脚本只检查决定落在 `TEST_CODE` 哪一侧，`TEST_CODE` 本身画得窄不窄，查不出来。所以 skill 写明：只有在 Step 3 确认过是测试代码的目录或模块，才能扩大 `TEST_CODE`，不能为了让一条决定通过而扩大。
- **D3 启动方法按名字检查，顶层调用给清单。**
  - `main` 按名字认，不需要语言分支，所以能做成检查。
  - 脚本顶层代码调用了哪些函数，要逐种语言解析才能确定检查。这一项给出文件清单，由模型读。
  - `calls` 为 0 的语言不列：它的每个函数本来都是候选，Step 6 已按事实缺口汇报。
- **D4 SDK 不是测试代码。**
  - 「只被测试依赖的模块」在仓库内看，和「只在仓库外被使用的 SDK」分不开。发布给其它项目、并有构建或 README 为证的模块，按对外 API 的规则决定。
- **D5 汇报措辞写进配方，不加文本闸。**
  - `medium` 小节的标题固定。另给一条 `medium` 信号统计的配方，「为什么没有 `high`」从这里取。
  - 不对最终汇报做正则检查。汇报不是文件；文本闸也只会逼模型删内容。

## Risks / Trade-offs

- `TEST_CODE` 画窄了查不出（D2）。dataverse 的一次运行漏了根目录的 `tests/`：2 个 Locust 任务记成了 `entry`。
- 入口决定的跨运行差异仍然大，影响的是 `low` / `medium` 的数量，不影响 `high`。
- 每次真实运行约 $4–5、20 分钟。每个语料在 D1–D5 下各跑了一次。最后一处修改（残余假设的汇总命令）在全部运行之后，没有用真实运行验证，只有契约测试。

## 验收记录

### 运行方式

- headless `claude -p "/excavator:excavator-unused-code <副本>"`，参数为 `--model sonnet --max-budget-usd 15 --plugin-dir <仓库> --permission-mode auto`，禁用 hook，串行。
  - 运行对象是 scratchpad 里的副本：dataverse（cc6e62e）与 Fineract（f9c2fcd）。原语料只读。
  - 每次运行前，把上一轮的决定脚本与产物移开，避免模型照抄。
- 对比对象是 `unused-code` 验收时的产物，下称「基线」。
  - 基线由会话内子代理产出，模型是 `claude-sonnet-5-5`；这次 headless 的 `sonnet` 解析为 `claude-sonnet-5`。
  - 模型不同只影响决定的重合度，不影响下面各项规则检查。
- 对比全用确定性脚本，不调用模型。它在 Fineract R3 的汇报上抓到了已知的 3 处过度表述，确认装置看得见：
  - 启动候选：Java `static main`；Python 与 shell 函数里在函数之外被调用的；JS 的同类。
  - 测试代码：路径启发式与模型写的 `TEST_CODE` 交叉核对。
  - 决定 id 的 Jaccard、各状态之间的迁移、`high` 是否一致。
  - 最终汇报的措辞：「名字在别处没有出现」，以及「nothing … calls」「dead」一类过度表述。
  - 副本里 `.excavator/` 以外的文件有没有改动。

| 运行 | skill | 花费 / 轮数 / 分钟 |
|---|---|---|
| Fineract R1 | 合入时的规则（0fe716c8） | $2.33 / 49 / 14.1 |
| dataverse R1 | 同上 | $3.14 / 71 / 16.9 |
| Fineract R2 | + `TEST_CODE` 检查、顶层调用清单（D1–D3） | $3.96 / 86 / 19.8 |
| Fineract R3 | + `main` 检查、SDK 不算测试代码（D3、D4） | $4.30 / 85 / 21.5 |
| dataverse R2 | + 汇报措辞（D5） | $4.91 / 97 / 21.9 |
| Fineract R4 | 同上 | $4.34 / 90 / 25.4 |

合计 $22.98。

### 规则检查

| | 测试代码记成 `entry` 的 id | Java `main` 已判 | 脚本顶层调用已判 | 汇报过度表述 |
|---|---|---|---|---|
| Fineract 基线 | 13 | 0 / 4 | Python 0 / 2 | — |
| Fineract R1 | 10 | 4 / 4 | Python 2 / 2 | 0 |
| Fineract R2 | 0 | 0 / 4 | Python 2 / 2 | 0 |
| Fineract R3 | 0 | 4 / 4 | Python 2 / 2 | 3 |
| Fineract R4 | 0 | 4 / 4 | Python 2 / 2 | 0 |
| dataverse 基线 | 150 | 8 / 8 | Python 5 / 8，JS 0 / 9 | — |
| dataverse R1 | 0 | 8 / 8 | Python 5 / 8，JS 0 / 9 | 0 |
| dataverse R2 | 2 | 8 / 8 | Python 8 / 8，JS 6 / 9 | 0（1 处擦边） |

- **测试代码（D1、D2）。**
  - Fineract R1 的 10 个都来自按机制写的宽查询：`equals` / `hashCode` / `toString`、`compareTo`、`afterPropertiesSet`。
  - 加了检查之后，Fineract 三次运行都是 0，决定里各有 14–40 条查询用到 `test_code` 拆分。
  - dataverse R2 的 2 个是 Locust 压测任务：模型写的 `TEST_CODE` 漏了根目录的 `tests/`。这正是 D2 的已知代价。
- **SDK（D4）。**
  - Fineract 有两个由 OpenAPI 生成、发布给其它项目的 SDK 模块：Java SDK 与它的 Feign 版本。R2 把两个都算进了测试代码：仓库里只有测试依赖它们。
  - 修正后，R3 与 R4 都按 README 与构建注释把 Java SDK 判为对外 API。
  - Feign 版本：R3 判为对外 API，R4 判为测试代码。R4 的理由有据：文档只在测试章节把它写成集成测试调用服务端的生成代码，唯一的发布证据是根构建里列出全部模块的发布清单，而 skill 规定这种清单不算对外 API 的证据。两种判断都有依据，记录在案。
- **启动（D3）。**
  - Fineract R2 一个 Java `main` 都没判：注意力被新加的顶层调用清单占走。加了 `main` 检查后，R3、R4 都是 4 / 4。
  - dataverse 唯一的 shell `main` 在基线与两次运行里都判了。
  - dataverse R2 没判的 3 个 JS 函数里：
    - 1 个在类方法体内，是对比脚本的启发式误报；
    - 2 个所在的文件没有被任何页面引用，模型核实后有意不判，并在汇报里写明。
  - shell 其余的顶层调用（Fineract 12、dataverse 16）按 D3 不列：shell 的 `calls` 为 0。
- **汇报（D5）。**
  - Fineract R3 把 `medium` 写成「仓库里没有调用」，还用类上的注解解释为什么没有 `high`。按信号统计，703 条 `medium` 里有 325 条只因为不是 `private` 而进不了 `high`；因为注解挡住的私有方法只有约 30 条。
  - 修正后的两次运行（dataverse R2、Fineract R4）都用了固定标题，没有过度表述。
    - dataverse R2 用 `medium` 的信号统计说明为什么不是 `high`（236 / 267 只因为不是 `private`）。擦边的一处：它说一批 `medium` 是「plausible dead code」，但紧接着写明只是 needs confirmation，没有断言未使用。它说 `visible-with-outside-supertype` 多是因为实体实现 `Serializable`，这句话不是从统计里取的，但核对成立：3,358 条中，3,147 条唯一的外部超类型就是 `Serializable`。
    - Fineract R4 引用的信号计数取自产物，但取的是 `low` 节点的统计，却写成「几乎每个未使用候选」，口径说宽了。
    - Fineract R4 没有列残余假设。之后补了汇总命令（任务 1.5），这一处没有用真实运行验证。

### 产物

| | 未使用（`high` / `medium` / `low`） | `entry` id 的 Jaccard（相对基线） | `test-entry` id 的 Jaccard |
|---|---|---|---|
| Fineract 基线 | 7,086（0 / 685 / 6,401） | — | — |
| Fineract R1 | 7,150（0 / 724 / 6,426） | 0.77 | 0.99 |
| Fineract R2 | 7,060（0 / 725 / 6,335） | 0.86 | 0.99 |
| Fineract R3 | 6,955（0 / 703 / 6,252） | 0.62 | 0.99 |
| Fineract R4 | 7,227（0 / 695 / 6,532） | 0.66 | 1.00 |
| dataverse 基线 | 5,800（7 / 271 / 5,522） | — | — |
| dataverse R1 | 5,867（7 / 270 / 5,590） | 0.37 | — |
| dataverse R2 | 5,676（7 / 267 / 5,402） | 0.71 | 0.94 |

- 每次运行的 `high` 都与基线逐个相同。
- 6 份产物都通过独立核对脚本。
- 副本里 `.excavator/` 以外的文件，6 次运行都没有改动。
- `entry` 的重合度在 0.37–0.86 之间。差异来自宽窄不同的机制查询：某一次判了 JPA 无参构造或 Spring 组件构造，另一次判了 Cucumber、Quartz、Liquibase。这些差异只在 `low` / `medium` 之间移动节点，不在规则范围内（Non-Goals）。

### 植入对照（召回）

上面的真实运行只量得出精度：Fineract 一个 `high` 都没有，一次永远不报 `high` 的运行也能通过。植入对照给出已知答案，用来量召回。

- **方法。** 不编译，不调用模型。
  - 用 `cp -Rc` 克隆 scratchpad 里的 Fineract 副本，只做文本编辑，在克隆里提交：Lazy 只分析已提交的版本。原语料与副本都不改。
  - 依次重建事实，生成候选，原样重放 Fineract R4 的决定脚本，出报告。
  - 模型没有见过植入的代码。植入的名字都带同一个前缀，没有决定能按名字选中它们。
- **检查。** 用确定性脚本。
  - 每个植入方法的状态、原因、置信度、信号、引用者与分组，要与期望一致。
  - `high` 的集合恰好等于期望为 `high` 的植入方法。
  - 没有决定查询选中植入的 id。
  - 未植入的节点逐个与 R4 产物比较状态、原因、置信度与信号名。
  - 守恒：未植入节点数加上离开候选集的节点数，等于 R4 的候选总数。离开的节点必须由植入事先声明，否则判红。
- **第 1 轮：规则。** 宿主是 `fineract-core` 里一个没有注解、没有外部超类型的 `final` 类。

| 植入 | 期望与结果 |
|---|---|
| `private static`，没人调用 | `high`，`unreferenced` |
| `private` 链：头调用尾，头没人调用 | 头 `high`，`unreferenced`；尾 `high`，`only-reachable-from-unused`，与头同组 |
| 新文件里的 `private static` | `high`，`unreferenced` |
| `public static`，没人调用 | `medium`，`not-private` |
| `public` 头调用 `private` 尾 | 头 `medium`，`not-private`；尾 `medium`，`capped` |
| `private`，名字写在另一个类的字符串常量里 | `low`，`name-elsewhere` |
| `private`，由 `ServerApplication.main` 调用 | 由决定移出 |
| Python 函数，没人调用 | `medium`（可见性与注解未知） |
| Python 函数，由 `main()` 调用 | 由决定移出 |

- **第 2–4 轮：事实可能解析不了的调用形式。** 都从一个路由可达的活方法里调用一个 `private` 方法。期望：不是 `high`。
  - 第 2 轮，lambda 与方法引用：事实解析了，两个方法都不是候选。
  - 第 3 轮，`var` 接收者由 `new` 初始化：同样解析了。它让原本没人调用的 `private` 构造函数变得可达，离开候选集。守恒检查因此判红，之后改成离开的节点必须声明。
  - 第 4 轮，`var` 接收者由方法调用初始化：这是审计在 Fineract 里找到的未解析形式。这次没有调用边，方法成了候选，`unreferenced`。名字普查在调用行找到同名，于是是 `low`，`name-elsewhere`。只有这一轮走到了「没有边、靠名字普查降级」这条兜底路径。
- **结果。** 四轮都通过。
  - 第 1 轮：11 个植入全部符合期望，`high` 恰好是 4 个植入，23,876 个未植入节点都没有变化。
  - 第 4 轮：23,875 个未植入节点没有变化，另有 1 个声明过的构造函数离开候选集。
  - 计数从 R4 的 7,227（0 / 695 / 6,532）变为 7,236（4 / 699 / 6,533）；由决定移出的从 2,135 变为 2,137。
  - 每轮重建事实约 80–90 秒，其余步骤几秒。
- **确认装置看得见。** 7 份改坏的产物全部判红：植入的 `high` 报成 `medium`、链尾缺失、链尾分到别组、丢了 `capped`、`low` 报成 `high`、改动一个未植入节点、多出一个 `high`。另外，第 4 轮的方法报成 `high` 判红，第 3 轮不声明离开的构造函数也判红。
- **不覆盖的。**
  - 框架入口（Spring、JPA、Cucumber 一类）没有植入。它们靠决定移出，而决定是重放的，所以这里不检验模型的入口判断；这部分由上面的真实运行检查。
  - shell 与 JS 没有植入。
  - 调用形式只试了这四种。兜底依赖名字普查：名字在运行时拼出来、源码里任何地方都没有写出的调用，名字普查也看不见。这是已知的残余风险。
  - 植入脚本绑定 Fineract 的具体文件，没有进仓库。规则本身由仓库里的单元夹具覆盖。
