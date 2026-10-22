执行约束：
- 代码、注释与测试用英文，没有中文字符；测试与注释不出现任何语料的名字。
- 本变更的文档、提交信息与 PR 正文只用语料代号。
- 验收 oracle 见 design.md，动手前已写死。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose audit-calls-target`
2. `fix(skill): report a calls edge whose target is not the declaration its site resolves to`：任务 1.1–1.2，用例与修复同一个 commit，每个 commit 上测试都是绿的。
3. `docs(skill): say how the audit marks a calls edge to the wrong declaration`：任务 1.3。
4. `docs(openspec): record audit-calls-target acceptance`：任务 2.1–2.2，评审前提交，评审能看到验收记录。
5. `test(skill): resolve a calls edge target through the call scope that skips re-exports`：任务 2.3 的用例。
6. `docs(openspec): record the rebase of audit-calls-target onto reexport-call-scope`：任务 2.3 的记录。
7. `fix(skill): treat a calls edge to another declaration as unsupported, not contradicted`：任务 2.4，第一轮评审的 Important 与 Nit（用例）。
8. `docs(skill): say a calls edge to another declaration is marked as unsupported`：任务 2.4。
9. `docs(openspec): revise audit-calls-target after review round 1`：任务 2.4，D2、规格增量、oracle 与第一轮记录。
10. `docs(openspec): record the review of audit-calls-target and archive`：任务 2.4 收尾。

## 1. 实现

- [x] 1.1 先写 O1、O2 的用例，放到 origin/main 的分离检出里对改动前的代码跑，记录失败（O1 失败、O2 通过）。
- [x] 1.2 `annotate-graph.mjs`：边循环之前算 `resolveUniqueCallSites` 并建映射；`findRecord` 对唯一解析的调用点比较目标文件；目标不符的边按 D2 标记、按 D3 计数，不进 `matchedRecordKeys`（D4）；新缺口与 stderr 汇总项（D5）；文件头与相关注释随之更新。验证：O1、O2 通过。
- [x] 1.3 `SKILL.md` 第 2.3 阶段补写这类边的标记与缺口。验证：`node scripts/check-refs.mjs`、三件套。

## 2. 验收与记录

- [x] 2.1 O4：逐个变异，记录变红的用例，然后还原。
- [x] 2.2 O3 全部门；O5 在真实语料快照上比较，先做装置先验，再按判据逐条记录。
- [x] 2.3 变基到 PR 57blocks/excavator#66（`callScopePaths`）之后：补 O1 h 与变异 vii，重跑 O3、O5。
- [ ] 2.4 评审（中风险档：reviewer 代理）、回复每条意见；验收记录写进 design.md，同步主规格并归档。
