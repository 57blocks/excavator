## Why

`/excavator-prd` 今天在一个上下文里把整个项目的 PRD 写成一个 Markdown：先列流程清单，再从头到尾写完，最后整篇核对。在 go-multirepo 这种规模（5 个成员仓库、约 600 条后端路由、约 40 个前端路由）上，这有三个问题：

- 单个上下文装不下全部流程的证据，长文档后半段的质量随上下文变差；上一次 1 万行级的 PRD 就是这样写出来的。
- 清单只打印给用户、不落盘，「N/N flows covered」是模型自报的，没有脚本能复核；中途停掉就从头再来。
- 文档没有任何机器可读结构：没有索引、没有按功能的边界，后续想按功能展示、或在功能上挂别的事实（问题、核验结果），只能去猜标题。

同时用户要一份「这个系统有什么问题」的清单：产品层面的行为缺陷（前端有校验后端没有、通知没有接收方、权限矩阵自相矛盾）和技术层面的代码问题。这是判断题，按 AI-first 门只能由模型写，但每一条必须落到 `file:line` 和一段原样引文上，否则就是意见不是事实。

## What Changes

把 `/excavator-prd` 改成「总览 → 按功能并发 → 汇总」的流水线，产物从一个文件变成一个目录：

- **Phase 1 总览与索引**：一个确定性脚本按框架模式目录从源码列出入口候选（路由、页面、定时任务、`main`），模型把候选分组成功能、给每个功能一份范围声明（入口、种子文件、跨层缝合），写成 `index.json`。脚本检查守恒：每个候选落且只落一个功能，或落进 `unassigned`。没有模式目录的框架记成可见缺口。
- **Phase 2 功能泳道**：每个功能一个子代理，写 `features/<id>.md`（PRD 章节，带 front-matter）和 `findings/<id>.json`（该功能的问题）。子代理直接写文件。一次最多派 `--concurrency`（默认 3）个，返回后再派下一批。脚本检查每条泳道的产物：锚点在项目内且行号存在、引文在文件里恰好出现一次、有 mermaid、findings 没有建议性措辞；不过的泳道标 `failed` 并记原因。
- **Phase 3 核对与汇总**：每个写好的功能按 `excavator-verify --fix` 核对，计数记进 `index.json`；脚本汇总状态（每个功能落且只落一个状态桶）、合并 findings、生成覆盖表与角色×功能表，并把总览与各功能拼成一份 `PRD.md`，保留今天的单文件交付物。
- **断点续跑**：重跑只补没写完、没核对或失败的功能；`--fresh` 才清空。
- **不碰目标项目的既有产物**：skill 只读 `.excavator/` 的事实，只写 `--out`（默认 `.excavator/prd/`），不触发 `/excavator`、不重建事实。
- `excavator-verify` 不改。
- **不做（后续变更）**：把 PRD 与 findings 打成独立的 `report.html`；mermaid 渲染；`excavator-verify` 输出逐条 JSON 以给每个功能挂核验徽章；跨功能的 findings（术语冲突、共享规则在两个功能里描述不一致）；Spring 等框架的入口事实进事实图。
- **不做**：对 findings 的模型核对（本变更只做锚点与引文的脚本检查，findings 的 `verdict` 固定为 `anchor-checked`）；给 findings 打严重度或置信度；给出修法。

## Capabilities

### Modified Capabilities

- `prd-generation`：清单落盘为 `index.json` 并由脚本守恒；按功能并发产出与断点续跑；功能级 findings 及其脚本检查；按功能核对；只写 `--out`；最后回复的行改为脚本打印的汇总计数。

## Impact

- 修改：`skills/excavator-prd/SKILL.md`（重写五个 Phase）；`tests/skill/test_prd_skill_contract.test.mjs`；`README.md` 与 `docs/deploy.md` 里对 `/excavator-prd` 的描述。
- 新增：`skills/excavator-prd/prd.mjs`（子命令 `entrypoints`、`check-index`、`check-lane`、`aggregate`、`assemble`，零模型调用）、`skills/excavator-prd/entrypoint-catalog.json`（框架 → 入口模式）、对应测试与合成夹具。
- 产物：`<out>/index.json`、`overview.md`、`features/*.md`、`findings/*.json`、`verification/*.md`、`findings.json`、`PRD.md`。
- 不新增 npm 依赖；skill 数不变。
- `excavator-doc-map` 不以本变更的 PRD 为输入（它由代码反推，再拿去对代码是自证循环）；这是使用规则，不是本变更的代码。
