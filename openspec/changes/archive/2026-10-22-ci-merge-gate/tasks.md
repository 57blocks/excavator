执行约束：
- 脚本、工作流、测试与注释用英文，零中文字符；本变更的文档、提交信息与 PR 正文都不出现语料名、私有名字与金丝雀的字面。
- 名单只放在 secret 与 agent 本地，测试用合成名单。
- 验收 oracle 见 design.md，动手前已写死。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose ci-merge-gate`
2. `test(doc-map): expect the evidence path cut only when it is longer than 80 characters`：任务 1.1。
3. `ci: run the full gate on every pull request`：任务 1.2、1.3。
4. `ci: scan each pull request's own text against name lists kept in secrets`：任务 1.4–1.6。
5. `docs(agents): name the checks a pull request must pass`：任务 1.7。
6. `test(ci): merge with an identity in the privacy-scan test, and check it stopped on the conflict`：任务 2.2 中 Linux 上暴露的问题。
7. `docs(openspec): fold the review's findings into ci-merge-gate`：任务 2.5。
8. `fix(ci): read every commit, merge and file the privacy scan used to miss`：任务 2.6。
9. `fix(ci): read the pull request's text when the privacy scan runs`：任务 2.7。
10. `docs(openspec): record ci-merge-gate acceptance before merge`：任务 2.1、2.4、2.8。

合并后另开一个 PR：

11. `docs(openspec): record ci-merge-gate probes and protection, and archive`：任务 3.1、3.2、3.4。
12. `docs(openspec): record how protection held the archive pull request`：任务 3.3，在第 11 步开出的 PR 上验完后补记。

## 1. 实现

- [x] 1.1 `tests/skill/test_doc_map.test.mjs`：证据路径的期望按脚本规则，超过 80 个字符才截断加「...」（design D8）。验证：该测试文件。
- [x] 1.2 `.github/workflows/ci.yml`：job `CI gate`，触发、并发、权限、超时与七个步骤按 D1。
- [x] 1.3 `.github/workflows/runner-image.yml` 开头注释不再说它是唯一的工作流（D8）。
- [x] 1.4 `scripts/ci/privacy-scan.mjs`：来源（D2）、两种范围（D3）、失败要关与只打计数（D4）、参数（D5）。
- [x] 1.5 `tests/ci/privacy-scan.test.mjs`：O1 的各条。验证：该测试文件，再按 O1 做变异。
- [x] 1.6 `.github/workflows/privacy.yml`：job `Privacy scan`，触发按 D6，secret 写文件、PR 文字的读取与 base（D5）。
- [x] 1.7 `AGENTS.md`：验证表后写明 PR 合并前必过的两个检查、CI 跑的是表的并集、`main` 受保护。验证：旧名字门禁测试。

## 2. 合并前的验收

- [x] 2.1 O1 变异，O2 本地全量门，O6 隐私检查。
- [x] 2.2 推送开 PR，O3 前半：`Privacy scan` 红且写明名单不可用；`CI gate` 绿。
- [x] 2.3 生成两个金丝雀（只存本地），`gh secret set` 设置 `PRIVACY_NAMES` 与 `PRIVACY_CORPUS`，重跑 `Privacy scan` 变绿（O3 后半）。
- [x] 2.4 验收记录写进 design.md，提交后两个检查仍绿，合并。
- [x] 2.5 干净上下文的审查子代理只读审本 PR，逐条核实它的发现，结论写进 design（D2、D5、D6、O1、O5、Risks）与 spec。
- [x] 2.6 脚本：完整遍历历史、合并提交读 remerge diff、去掉整体差异、按文本读并去掉 NUL、作者、三个以上父提交的合并退出 2；测试补上审查发现的各种情形，重做变异。
- [x] 2.7 工作流：标题、分支名与正文运行时经 API 读取，手动触发读分支的 PR，base 运行时取合并基点。
- [x] 2.8 重跑本地全量门与 O6，推送后两个检查在 PR 上绿。

## 3. 合并后

- [x] 3.1 O4 五个探针，事后删除探针分支。
- [x] 3.2 按 D7 开分支保护，读回核对（O5 前半）。
- [x] 3.3 归档记录 PR：检查跑完前 `mergeable_state` 为 `blocked`；标题改成含金丝雀时重扫变红、改回变绿；变绿后合并（O5 后半）。
- [x] 3.4 同步主规格并归档。
