## 1. 名字候选（脚本）

提交：`feat(product-handbook): the names command lists the system name candidates the code writes`

- [ ] 1.1 夹具与手写期望的测试，先红（design O1）
- [ ] 1.2 候选模块与 `handbook.mjs names`（design D1）

## 2. 概览的名字

提交：`feat(product-handbook): the overview names the system with one of the candidates`

- [ ] 2.1 形状、项与主张、`check-overview` 的名字检查，旧概览的兼容（design D2、D4）；测试先红（design O2）
- [ ] 2.2 `sections/overview.md`：第 2 步打印候选，提示里的名字规则；合约测试更新摘要

## 3. 呈现

提交：`feat(product-handbook): the handbook and the page carry the system name, never the directory name`

- [ ] 3.1 手册标题与没有名字时的固定文字；页面数据、标题栏、浏览器标题、眉题（design D3）
- [ ] 3.2 渲染与页面测试（design O3）

## 4. 验收

提交：`docs(openspec): record handbook-system-name acceptance`

- [ ] 4.1 变异检查，结果写进 `acceptance.md`
- [ ] 4.2 O4 真实运行，照实记录
- [ ] 4.3 受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑（O5）
