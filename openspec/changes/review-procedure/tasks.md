执行约束：
- `REVIEW.md`、审查代理与 PR 模板用英文，零中文字符；`AGENTS.md` 与本变更的文档用中文。
- 本变更的文档、提交信息、PR 正文与审查评论不出现语料名、私有名字与金丝雀的字面。
- 验收 oracle 见 design.md，动手前已写死。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose review-procedure`
2. `docs(review): say what to flag in this repository in REVIEW.md`：任务 1.1。
3. `chore(agents): add a fresh-context reviewer agent`：任务 1.2。
4. `docs(github): add a pull request template`：任务 1.3。
5. `docs(agents): add risk tiers and the review procedure`：任务 1.4。
6. 审查各轮的修复提交（如有），每个修复一个提交。
7. `docs(openspec): record review-procedure acceptance, and archive`：任务 2.5、3.1。

## 1. 实现

- [ ] 1.1 `REVIEW.md`：按 D2 的各项。
- [ ] 1.2 `.claude/agents/reviewer.md`：输入、规则来源、读取、只读、发布与范围模式的输出，按 D3。
- [ ] 1.3 `.github/pull_request_template.md`：四节，按 D7。
- [ ] 1.4 `AGENTS.md`「审查」一节：风险档表（D4）、回应（D5）、收敛（D6）、PR 正文按模板。

## 2. 验收

- [ ] 2.1 O1：植入缺陷，范围模式审查，报出 Important 且指向该行；核对没有写 GitHub。
- [ ] 2.2 O2 本地部分与 O5，推送开 PR（正文按模板）。
- [ ] 2.3 开 `required_conversation_resolution`，读回（O4 前半）。
- [ ] 2.4 O3：审查代理审第一轮，回应并解决每条发现，按 D6 决定是否再审；O4 后半。
- [ ] 2.5 验收记录写进 design.md；两个检查绿后合并（D8）。

## 3. 归档

- [ ] 3.1 同步主规格并归档，与验收记录同一个提交。
