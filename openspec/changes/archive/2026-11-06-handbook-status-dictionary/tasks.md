## 1. 抽取（脚本）

提交：`feat(product-handbook): the data command lists the value sets, with their comments and display names`

- [x] 1.1 夹具 `tests/fixtures/product-handbook/dict-project/` 与手写期望的测试，先红（design O1）
- [x] 1.2 Go、TS、JS 的值集合与值（design D2）
- [x] 1.3 注释与显示名（design D3）
- [x] 1.4 桶与守恒（design D4）、同名不同值（design D5）
- [x] 1.5 `dictionaries.json` 的写出与形状校验，计数行；`sections/data.md` 照抄两行，合约测试更新摘要（design D1）

## 2. 呈现

提交：`feat(product-handbook): the technical view shows the status dictionary`

- [x] 2.1 `ui-strings.json` 新键；数据一章加「状态字典」一节，缺失或不合格时一行说明（design D6）
- [x] 2.2 页面数据 `/7`、`#/dictionaries` 路由、侧栏链接、字典页；产品视图没有
- [x] 2.3 渲染与页面测试（design O2）

## 3. 验收

提交：`docs(openspec): record handbook-status-dictionary acceptance`

- [x] 3.1 变异检查，结果写进 `acceptance.md`
- [x] 3.2 O3 真实运行、交叉核对与分层抽查，没过的线照实写
- [x] 3.3 受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑（O4）
