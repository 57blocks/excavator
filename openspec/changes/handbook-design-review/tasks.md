## 1. 部分、选项与前置条件（design D1）

- [x] 1.1 `lib/sections.mjs`：
  - 新的部分 `review`；
  - 默认不含它，`--review` 加上它，选中时带上 `remedies` 与 `outline`；
  - 对策改读 `sections/remedies.md`。

  验证：`sections` 的单元测试覆盖默认、`--review`、`--sections review`、非法值。
- [x] 1.2 `check --before review`：地图存在、每个功能有已记录的章节，否则逐行打印缺什么，退出 1。验证：测试覆盖没有地图、缺 3 个功能章节、全部通过三种情况。
- [x] 1.3 把对策从 `sections/cross.md` 移到 `sections/remedies.md`，`cross.md` 改为两轮派发；`SKILL.md` 的选项与部分清单加上 `review` 与 `--review`。验证：`test_product_handbook_skill_contract` 与读 SKILL.md 的技能测试通过。
- [x] 1.4 让新的一章被认出来：
  - `review` 加进跨功能章节的清单（检查的种类、建议词规则）；
  - 加进拼装的默认顺序（缺陷之后、对策之前）；
  - 加进目录阶段列出的章节。

  验证：`assemble`、`page` 的测试用一份带 `review.md` 的输出，没有 `Outline:` 行，页面里出现这一章。

## 2. 事实、结构化的项与生成的章节（design D2、D3、D7）

- [x] 2.1 `review facts`：每个功能的操作数、步骤数、状态数与转换数、系统内部步骤数、交接数，以及引用了同一段代码的功能对（分批内与跨批）；认不出的小节不计数并写明。验证：用夹具章节断言每个数字，并测一个旧小标题的章节。
- [x] 2.2 `review render`：校验项的字段、引文来自所列功能的章节、两处引文的维度、数字来源、读者文字规则；通过后生成 `chapters/review.md`（固定标题、计数表、每项的字段）。验证：每条拒绝规则一个反例测试，以及一个通过的批生成的章节能通过 `check`。
- [x] 2.3 `ui-strings.json` 加 D7 的键。验证：`ui.test.mjs` 与 `check-ui` 的测试通过。

## 3. 核验与删项（design D5）

- [x] 3.1 `review claims`：打印每一项与它每条引文所在的章节行原文；`review prune`：按核验结果删项、写 `entries/review-removed.json`、重新生成章节。验证：测试断言打印的原文与删除记录，删项后章节仍通过 `check`。

## 4. 提示词（design D4、D6）

- [x] 4.1 `sections/review.md`：前置条件、分批、事实、每批写作、跨批写作、核验、删项、状态与续跑、告诉用户的话。验证：契约测试断言阶段文件被 `sections` 列出，提示词里的变量都有来源。
- [x] 4.2 `sections/remedies.md`：读设计问题、按维度写改进措施、建议注明针对的对象、输入摘要变了就重写。验证：`check` 记录 `inputs`，摘要变化时对策被判为待写的测试。
- [x] 4.3 回复：没写设计问题时说明 `--review`；写了时报出保留与删除的项数。验证：`reply` 的测试。

## 5. 验收

- [ ] 5.1 在一份已有真实输出（72 个功能）的副本上以 `--sections review` 运行。
  - 记录花费、各批的项数、删除数；
  - 按维度分层抽查保留的项，报出精度；
  - 抽查删除的项是否删对；
  - 检查对策是否覆盖设计问题；
  - 检查页面里出现这一章。
  - 结论写进 `acceptance.md`。
