提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入；全程 build-free）：

1. `docs(skill): check test code and list top-level launches in excavator-unused-code`：任务 1.1、1.2。
2. `docs(skill): decide every launch method and keep SDKs out of test code`：任务 1.3。
3. `docs(skill): report medium and unreferenced only as the facts state them`：任务 1.4。
4. `docs(skill): gather the residual assumptions for the unused-code report`：任务 1.5。
5. `docs(openspec): record unused-code rule checks and archive`：任务 2.1–2.3。

任务 1.6 随 1.1–1.5 各自的 commit 完成。

## 1. skill

- [x] 1.1 Step 3 写出 `TEST_CODE`；Step 4 的 `decide()` 把它变成 `test_code`，拒绝选中测试代码的 `entry` 与选中测试代码以外的 `test-entry`，记录的查询自带定义（D1、D2）。
- [x] 1.2 Step 3 列出有调用事实的脚本语言里、函数没有调用者的文件，模型读顶层代码后决定（D3）。
- [x] 1.3 Step 3 列出名为 `main` 的候选，决定脚本在其中有未决定的候选时拒绝写出决定文件；测试代码不含对外发布的模块（D3、D4）。
- [x] 1.4 Step 6 固定 `medium` 标题，给出 `medium` 信号统计；`unreferenced` 只说事实里没有引用，计数只用产物解释（D5）。
- [x] 1.5 Step 6 的汇总命令打出全部残余假设，汇报逐条列出。
- [x] 1.6 契约测试逐条钉住新规则，并执行 skill 里写的 Step 4 脚本；每条钉住的规则都做变异，测试变红。

## 2. 验收与归档

- [x] 2.1 headless Sonnet 在 Fineract 与 dataverse 上重跑，与修正前的产物做确定性对比，结果写进 design.md 的验收记录。
- [x] 2.2 新产物通过独立核对脚本。
- [x] 2.3 全量门：vitest、`check-refs`、`openspec validate --all --strict`；归档并同步主规格。
