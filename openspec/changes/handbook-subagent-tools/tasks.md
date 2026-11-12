## 1. 代理的工具与派发文字

提交：`feat(product-handbook): every handbook subagent gets a named agent type with only the tools its task uses`

- [x] 1.1 测试先红：代理定义的 `tools` 与派发文字的合约（design O1）
- [x] 1.2 五个代理定义加 `tools`；新代理 `excavator-handbook-writer`（design D1、D2、D4）
- [x] 1.3 `SKILL.md`、`stages/*.md`、`sections/*.md` 的派发文字点名代理类型（design D3）

## 2. 验收

提交：`docs(openspec): record handbook-subagent-tools acceptance`

- [x] 2.1 O2 启动上下文实测
- [x] 2.2 O3 真实冒烟，没过的线照实写
- [x] 2.3 受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑（O4）
