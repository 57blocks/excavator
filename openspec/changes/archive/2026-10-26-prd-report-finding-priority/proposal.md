## Why

`/excavator-prd-report` 在一个功能少的子项目上就产出几十条 findings，它们按功能排列，没有轻重之分，读者要逐条读完才知道哪些该先处理。用户要求 findings 按 P0、P1 排序。

## What Changes

- **新的排序步骤**：所有章节核对完之后，skill 派排序子代理（前台、按章节顺序分批，每批不超过 120 条 findings），按一份写死的判据给每条 finding 定 `P0`、`P1` 或 `P2`，并写一句理由，说明满足了哪条判据、影响到谁。每个功能写一个 `priorities/<id>.json`。泳道仍然不写严重度：定级由看不到泳道上下文的独立子代理按同一判据做，各功能尺度一致。
- **新命令 `prd.mjs check-priorities <out> --project <root>`**：检查每个已写成功能的定级文件与 `findings/<id>.json` 一一对应（每条 finding 恰好一次、没有多余的 id），级别只取三个值，理由非空、不超过 300 字符、不含建议性措辞。不过的功能重派一次排序；第二次仍不过，它的 findings 记为未定级（`unranked`），不阻断 PRD 与报告页。
- **`aggregate`**：把有效的定级并进 `findings.json`（每条加 `priority` 与 `priorityReason`，未定级为 `null`），并按级别（P0、P1、P2、未定级）、章节顺序、finding 序号排序；每个功能的计数加上各级别条数；打印的计数加上按级别的合计。
- **最后的回复**：findings 那一行加上按级别的条数，例如 `16 product, 36 technical findings, anchors checked: 2 P0, 9 P1, 41 P2, 0 unranked`。数字仍来自 `aggregate`。
- **报告页**：每条 finding 显示级别标记（文字加颜色，不只靠颜色）与理由；findings 页默认按级别排序，可按级别筛选（片段路由加 `priority=`）；总览显示各级别条数；功能页里的 findings 也按级别排。
- **续跑**：已有合格定级文件的功能不再排序；缺失或不合格的才排。之前已跑完的产物目录（没有任何定级）用同一命令再跑一次，就只补排序与之后的汇总、拼装、报告页，不重写章节。

**不做**：
- 在 `PRD.md` 里列 findings；findings 仍只在 `findings.json` 与报告页。
- 让模型给出修法、工作量或置信度；理由只说满足了哪条判据、影响到谁。
- 调整 PRD 的结构（另一个变更 `prd-report-prd-shape`）。

## Capabilities

### Modified Capabilities

- `prd-report`：新增 findings 定级的要求；功能级发现说明定级由排序步骤给出；最后回复的计数行带上级别；报告页按级别排序与筛选。

## Impact

- `skills/excavator-prd-report/`：`SKILL.md`（排序步骤与排序子代理的提示词）、`prd.mjs`、`lib/aggregate.mjs`、新增 `lib/priorities.mjs`（或同类）、`lib/index-check.mjs`（计数的形状）、`lib/reply.mjs`、`lib/page-data.mjs`。
- `packages/prd-report-page/`：finding 卡片、findings 页的筛选与排序、总览计数、路由。
- `tests/skill/excavator-prd-report/`、`tests/skill/test_prd_report_skill_contract.test.mjs`、`packages/prd-report-page/test/`。
- 旧产物目录的 `index.json` 缺少按级别的计数：`page` 会要求先运行 `aggregate`，skill 的流程本来就先运行它。
