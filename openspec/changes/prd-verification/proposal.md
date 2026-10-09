## Why

`excavator-prd` 在 Apache Fineract「贷款账户」（约 640 个主代码 Java 文件）上生成了一份覆盖 356 条流程的 As-Is PRD。确定性审计显示其 1,790 处 `file:line` 引用与 706 个代码标识符全部真实存在，但独立的干净上下文核对抽查 60 条说法发现 4 条错误（3 矛盾、1 错归属），39 处「待确认」里 3 处的暂定说法是错的、26 处其实代码已有定论。

错误的形态一致：**没有凭空捏造的实体，错在边界结论**——否定性结论（「不会发生」「未被使用」）、可达性与先后顺序、触发机制（事件还是直接调用）、「一律如此」的绝对化说法，以及未与全文其它章节对齐的推测。零编造是硬指标，这类错误必须在交付前被拦下；而现有 Phase 4 只做覆盖、图、枚举、术语四项形式自检，看不见它们。

同一份独立核对证明了「只核高风险类别 + 全仓搜索 + 跨章节一致性」能找到这些错误；但它以单代理串行、从零定位源码的方式跑了约 37 分钟，长于 PRD 生成本身（21 分钟）。需要把核对做成可并行、只针对高风险类别、可单独调用的环节，并让写作阶段先行自证，压低核对的时间与费用。

## What Changes

- 新增 skill `excavator-verify`：对一份已有的 As-Is 文档（首要对象是 `excavator-prd` 的 PRD）按源码核对。只核五类高风险陈述——否定性结论、可达性/先后顺序、触发机制、绝对化/不变性说法、未决的「待确认」项——外加跨章节一致性；按章节并行派子代理；每条落入可见判定桶并附 `file:line` 证据；产出核对报告，`--fix` 时就地改正文档（只改错、不增内容、不给建议）。可单独对既有文档调用，便于直接测量核对的准确率、时间与费用。
- 修改 `excavator-prd`：写作阶段要求对上述高风险陈述先做全仓搜索取证，否则写成「待确认」并注明已搜索范围；Phase 4 在保存前调用 `excavator-verify --fix`，并报告其计数。
- 文档与测试对齐：README 增加 `/excavator-verify` 用法；`tests/install/install.test.mjs` 的 skill 数由 9 改为 10 并断言包含 `excavator-verify`。

## Capabilities

### New Capabilities

- `document-verification`: 定义「按源码核对 As-Is 文档的高风险陈述」为一个可单独调用的 AI-first skill 能力——风险类别选择、全仓搜索取证、并行分章核对、无第四态的判定桶、跨章节一致性、核对报告与 `--fix` 就地改正。

### Modified Capabilities

- `prd-generation`: 新增「写后核对」要求——高风险陈述写作时须有全仓搜索证据或标注待确认；保存前必须经过 `excavator-verify --fix`。

## Impact

- 仅新增 `skills/excavator-verify/SKILL.md`（散文编排）并修改 `skills/excavator-prd/SKILL.md`；零产品代码、零新依赖，`.excavator/` 布局不变。AI-first scope gate：核对是判断题（读源码、判断陈述真假），由 skill 在运行时完成即可；无需确定性复用或持久化契约，故不落代码。
- 每份 PRD 的生成时间与费用会增加；本变更以 Fineract 实测给出增加幅度（见 design.md 验收）。
- 其它 skill、agent 与确定性契约不变；插件缓存需重装刷新才可用 `/excavator-verify`。
