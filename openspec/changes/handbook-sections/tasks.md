## 1. `sections` 命令（脚本）

提交：`feat(product-handbook): a sections command that lists the files a run reads`

- [x] 1.1 `handbook.mjs sections <list>`：取值、默认、依赖去重、固定顺序、非法值退出 1（design D2）
- [x] 1.2 测试（design O1），先红后绿

## 2. 阶段文字移进部分文件

提交：`refactor(product-handbook): each section's phases live in a file of their own`

- [x] 2.1 `stages/map.md`（第 3、3c 阶段）、`sections/overview.md`（第 3b 阶段）、`sections/features.md`（第 4 阶段），原文逐字移过去
- [x] 2.2 `SKILL.md`：「Sections」一节（跑 `sections`、按序读文件、没读的阶段不跑、第 5、6 阶段只处理所选部分的单元）；选项里加 `--sections`；第 0 阶段解析它；分工表与文件表提到部分文件
- [x] 2.3 合约测试（design O2）：三个文件等于 main 上原文（钉摘要），`SKILL.md` 不再含这些正文

## 3. 验收

- [ ] 3.1 变异检查（design O2 两条），结果写进 `acceptance.md`
- [ ] 3.2 O3 两次真实运行，结果写进 `acceptance.md`，没过的线照实写
- [ ] 3.3 受影响测试、`check-refs`、`openspec validate --all --strict` 本地通过；全量门在分离检出里跑（O4）
