## 1. 单元与检查（脚本）

提交：`feat(product-handbook): each feature has a findings unit with the checks of an entry`

- [x] 1.1 夹具与测试先红：形状、类别枚举、单元 id、状态键、空发现、各检查的反例（design O1）
- [x] 1.2 形状、项与主张、修剪、检查；`unit.mjs` 第三种单元；`state.json` 的 `findings` 键（design D2、D3、D4）
- [x] 1.3 `check-findings`、`try-findings`；`mark`、`slices`、`verdicts`、`trace`、`trace-verdicts` 接受发现单元的 id
- [x] 1.4 `ui-strings.json` 的类别显示名与 `findings.adviceWords`

## 2. 阶段文字

提交：`feat(product-handbook): the findings section writes, verifies and traces the findings of each feature`

- [x] 2.1 `lib/sections.mjs` 加 `findings`；`sections/findings.md` 第 4c 阶段与子代理提示（design D1、D5）
- [x] 2.2 `SKILL.md`：第 5、6 阶段列出发现单元，「部分」规则，开头规则 1 的措辞（design D6、D8）；合约测试更新摘要

## 3. 呈现

提交：`feat(product-handbook): the handbook and the page show the verified findings`

- [x] 3.1 「发现」一章、功能一节里的发现、覆盖（design D7）
- [x] 3.2 页面数据 `/8`、`#/findings`、侧栏、功能页的发现
- [x] 3.3 渲染与页面测试（design O2）

## 4. 范围词的追查

提交：`feat(product-handbook): tracers build a case for every scope word of a finding`

- [x] 4.1 测试先红：追查文件的 `scopeWords`、`trace-verdicts` 对 `scope` 的检查、条目的追查文件不带这个键（design D9）
- [x] 4.2 `ui-strings.json` 的 `md.findings.scopeWords`；`trace` 与 `trace-verdicts`；追查者 agent 与 `sections/findings.md` 的措辞；合约测试更新摘要

## 5. 验收

提交：`docs(openspec): record handbook-feature-findings acceptance`

- [x] 5.1 变异检查，结果写进 `acceptance.md`
- [x] 5.2 O3 真实运行与独立抽查，没过的线照实写
- [x] 5.3 受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑（O4）
