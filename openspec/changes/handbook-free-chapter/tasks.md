## 1. 正文与事实表

- [x] 1.1 测试先红：`check-chapter` 的接受、每种结构拒绝、每种内容问题只记数、切项与 id、报数；去掉若干项后的正文；`/3` 事实表的形状与拒绝；已核实 `/2` 照常拼装
- [x] 1.2 正文的解析与检查（切项、出处解析成 `{file, lines, passage}`、时序图子集与最少一张、内容问题记成 `notes`）；`/3` 事实表；`check-entry` 与 `try-entry` 一起检查两者；`check-chapter` 命令
- commit：`feat(excavator-product-handbook): free chapter and /3 fact sheet with their checks`

## 2. 拼装与页面

- [x] 2.1 测试先红：`checked` 的 `/3` 写进手册与页面并带「未核对」；产品视图不带出处；覆盖一节的未核对数与内容问题计数；时序图从正文得出；汇总从 `/3` 得出，与同内容的 `/2` 相同；横切主题读 `/3` 正文项；第 5 阶段不列 `/3`，`slices` 对 `/3` 退出 1
- [x] 2.2 `render`、`page-data`、`page-units`、`entities`、`topics-facts`、术语表、待确认问题、`state`、`slices` 按 D0、D10、D11、D12 改
- commit：`feat(excavator-product-handbook): assemble and page unverified free chapters`

## 3. 领域流程图

- [ ] 3.1 测试先红：`check-domain-flows` 的四种边、每种拒绝、3 次不过的固定文字；画图确定性
- [ ] 3.2 `check-domain-flows`、`stages/domain-flow.md`、领域页与 `handbook.md` 的图
- commit：`feat(excavator-product-handbook): domain flow diagrams checked against chapters and fact sheets`

## 4. 提示词

- [ ] 4.1 合约测试先红（O3）
- [ ] 4.2 `sections/features.md` 写作提示词；`SKILL.md`：`/3` 跳过第 5、6 阶段，写完条目后读 `stages/domain-flow.md`；`agents/excavator-handbook-writer.md`
- commit：`docs(excavator-product-handbook): writers write a free chapter and a fact sheet`

## 5. 验收

- [ ] 5.1 O2 变异
- [ ] 5.2 O5 测试与检查
- [ ] 5.3 O4 真实运行（先报花费）与独立审读，写 `acceptance.md`
