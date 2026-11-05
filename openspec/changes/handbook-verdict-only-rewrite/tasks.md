提交顺序（一个逻辑步一个 commit，PR 用 `--merge`）：
1. OpenSpec 变更；
2. 脚本与单元测试；
3. SKILL.md 与合约测试；
4. 验收记录。

## 1. 脚本

- [x] 1.1 把 `verdicts.mjs` 里 `roundTwo` 的「删项、判 failed、校验、写条目」抽成两轮共用的函数（D1）
- [x] 1.2 `verdicts --round 1`：先删 `contradicted` 的项并记录；没有 `unverified` 时直接 `confirmed`；有时只把 `unverified` 写进改写文件，状态带 `removed`（D1）
- [x] 1.3 `roundTwoPlan` 收第一轮已删项的 id，它们与挂在下面的项缺失不报 `missing`；第二轮定案时合并两轮的 `removed`（D2）
- [x] 1.4 `roundTwoPlan` 比较列出项及其下挂项的 `claim`，不同就报 `<item id>: listed for rewriting, but its claim changed; only its citations may change`（D3）
- [x] 1.5 夹具测试覆盖 O1 的每一条，并做 O1 的三个变异检查，结果写进验收记录

## 2. SKILL.md

- [x] 2.1 第 5 阶段第 3 步：`verdicts --round 1` 的新输出（删去的项数、是否有改写文件）与下一步
- [x] 2.2 第 4 步改写提示词按 D4 改；第 5 步说明 `slices --round 2` 拒绝改了主张的项
- [x] 2.3 第一节「Nothing stays that the code does not back up」那句跟着改；合约测试按 O2 加断言

## 3. 验收

- [ ] 3.1 受影响测试、`check-refs`、`openspec validate --all --strict` 本地通过；全量门在分离检出里跑（O4）
- [ ] 3.2 已知错误库 A、B 各跑一次，按 O3 打分（Sonnet，花费上限各 $15）
- [ ] 3.3 验收记录 `acceptance.md`：O1–O4 的结果、变异检查、花费，没过的线照实写
