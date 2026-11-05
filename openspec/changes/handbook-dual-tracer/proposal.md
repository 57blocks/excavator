## Why

产品手册的每一项在两名核对者定案后，再由一名能读全项目的追查者找反证（`product-handbook-map` 的 D14）。go-multirepo「报销」功能上 30 项分层编造抽查的矛盾数依次是 6/30、3/30、1/28、2/28、2/28。`handbook-value-source` 补了值来源规则之后，剩下的漏判不是规则缺了什么，而是**同一份文件、同一个模型，有时抓到、有时放过**：

- 同地往返的判定比主张窄：装置里 7 次抓到 6 次，真实运行放过；
- 「打开不属于自己的记录会跳到审批详情」说宽了：装置里 6 次抓到 3 次，真实运行放过；
- 汇率日期的来源：真实文件上 3 次抓到 2 次，真实运行那一次放过。

这和两名核对者之前遇到的情形相同：单次判断随机漏看，同一份文件再跑一次就抓到。核对者那一步用「每份两名、互不相见」解决了；追查者现在每份只派一名。零编造是硬指标，所以本变更把追查也改成每份两名，任一名找到反证就删。

## What Changes

- **每份两名追查者**：`trace` 为每份写一个追查文件，并打印两个判词文件 `trace-verdicts/<id>/part-<n>.a.json` 与 `part-<n>.b.json`。SKILL.md 第 6 阶段为每份派两名 `excavator-handbook-tracer`，提示相同、只有各自的判词文件不同，互不告知。
- **逐个文件守恒与校验**：`trace-verdicts` 对每个判词文件单独执行现有的全部检查（每项恰好一个判词、两种判词、一行理由、`contradicted` 带项目内有效的 `at`、读者可见理由过门、同一文件内 `holds` 理由不重复）；问题按 `part <n><x>` 开头；任一文件缺失或被拒，什么都不记，`Next:` 行只点名要重派的那几个份-字母。
- **按「或」合并**：一项只要有一名追查者判 `contradicted`（其文件已通过校验，`at` 有效）就删去。删去的记录保留读者看到的一条理由（按 a、b 的顺序取第一名判 `contradicted` 的），另加 `reasons` 列出每一名判 `contradicted` 的追查者的理由，`at` 为它们全部位置的并集（按文件与行去重）。
- **重派**：每个缺失或被拒的份-字母只重派一次；仍不成立，功能停在 `confirmed`，手册覆盖一节列为核对未完成。不退回到只用一名追查者的判词。
- `agents/excavator-handbook-tracer.md` 只改判词文件的路径写法；判法不变。状态校验接受删去记录上的 `reasons`。合约测试与脚本测试跟着改。

**不做**：
- 不改用 Opus 追查：核对者那一步试过 Opus，抓得住但把抽查确认为真的项也拒了，花费约 5 倍。
- 不用三名追查者取多数：多数票会把一名抓到、两名放过的错误留下，方向反了。
- 不再加追查规则：剩下的漏判在装置上都被同一份规则抓到过，缺的是稳定性，不是规则。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `product-handbook`：「逐项核对」一条里，追查由一名追查者改为每份两名，任一名判 `contradicted` 就删去，判词文件逐个校验。

## Impact

- `skills/excavator-product-handbook/lib/trace.mjs`、`trace-plan.mjs`、`trace-verdicts.mjs`、`removal-records.mjs`、`state.mjs`；`SKILL.md` 第 6 阶段与文件表；`agents/excavator-handbook-tracer.md` 的输入一节。
- 测试：`tests/skill/excavator-product-handbook/trace.test.mjs`、`tests/skill/test_product_handbook_skill_contract.test.mjs`。
- 花费：每个功能的追查花费约翻倍（上两次真实运行 89 项 4 份 $4.54 与 $5.09，预计 $9–10）；每份两名同时派出，8 名以内一条消息派完，时长基本不变。
- 召回：「或」会让真话被误删的机会约翻倍；O1 与 O3 实测并记录。
- 页面与 `handbook.md` 的形状不变：读者仍看到每个删去项的一条理由。
