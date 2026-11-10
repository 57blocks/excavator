## 1. 正文与事实表

- [ ] 1.1 测试先红：`check-chapter` 的接受与每种拒绝、切项与 id、报数；`/3` 事实表的形状与拒绝；已核实 `/2` 照常拼装
- [ ] 1.2 正文的解析与检查（切项、出处解析成 `{file, lines, passage}`、数字、标签、禁词、语言、时序图子集与最少一张）；`/3` 事实表；`check-entry` 与 `try-entry` 一起检查两者
- commit：`feat(excavator-product-handbook): free chapter and /3 fact sheet with their checks`

## 2. 核对与追查接受正文的项

- [ ] 2.1 测试先红：正文项进核对文件（行号范围前后 20 行、标题取前 5 个出处）；替换文件的接受与拒绝；`narrowed`；删项的每种块；追查文件；所引行改动后拒绝
- [ ] 2.2 `items`、`slices`、`verify-plan`、`verdicts`、`trace`、`trace-verdicts`、代码切片按 D2、D3、D5、D6 改；定案稿 `chapters/<id>.final.md`
- commit：`feat(excavator-product-handbook): verify and trace the items of a chapter`

## 3. 拼装与页面

- [ ] 3.1 测试先红：功能一节与领域明细写出定案正文（产品视图不带出处）与事实表速查；时序图从正文得出并重新编号；汇总从 `/3` 得出，与同内容的 `/2` 相同；横切主题读正文项
- [ ] 3.2 `render`、`page-data`、`page-units`、`entities`、`topics-facts`、术语表、待确认问题按 D10、D11 改
- commit：`feat(excavator-product-handbook): assemble and page the free chapters`

## 4. 领域流程图

- [ ] 4.1 测试先红：`check-domain-flows` 的四种边、每种拒绝、3 次不过的固定文字；画图确定性
- [ ] 4.2 `check-domain-flows`、`stages/domain-flow.md`、领域页与 `handbook.md` 的图
- commit：`feat(excavator-product-handbook): domain flow diagrams checked against verified items`

## 5. 提示词

- [ ] 5.1 合约测试先红：写作提示词、改写提示词、核对者与追查者定义（O3）
- [ ] 5.2 `sections/features.md` 写作提示词；`SKILL.md` 第 5 阶段改写提示词与替换文件、第 6 阶段之后读 `stages/domain-flow.md`；三个 agent 定义
- commit：`docs(excavator-product-handbook): writers write a free chapter and a fact sheet`

## 6. 验收

- [ ] 6.1 O2 变异
- [ ] 6.2 O5 测试与检查
- [ ] 6.3 O4 真实运行（先报花费）与独立审读，写 `acceptance.md`
