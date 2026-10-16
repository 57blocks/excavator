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
