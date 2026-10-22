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
6. 第一轮审查的修复：
   - `docs(review): keep the review procedure in REVIEW.md, and count only a pull request's own commits`
   - `chore(agents): have the reviewer read the head and post only after the privacy scan`
   - `docs(openspec): fold round 1 findings into review-procedure`
   第二轮审查的修复：
   - `docs(review): name the reviewer in REVIEW.md, and count a round only once it is posted`
   - `chore(agents): check the reviewed commit's privacy scan, and read only a clean tree`
   - `docs(openspec): fold round 2 findings into review-procedure`

   第三轮是最后一轮：第三轮之后无论哪种原因还需要再审（有 Important，或 PR 自己的新提交触及中高档路径），都停下，不合并，交给用户。
   第三轮审查的修复：
   - `docs(openspec): stop review-procedure after round 3 for any reason, as the spec says`
7. `docs(openspec): record review-procedure acceptance, and archive`：任务 2.5、3.1。

## 1. 实现

- [x] 1.1 `REVIEW.md`：按 D2 的各项，以及风险档表（D4）、回应（D5）与收敛（D6）。
- [x] 1.2 `.claude/agents/reviewer.md`：输入、规则来源、读取、只读、发布与范围模式的输出，按 D3。
- [x] 1.3 `.github/pull_request_template.md`：四节，按 D7。
- [x] 1.4 `AGENTS.md`「审查」一节：指向 `REVIEW.md` 的流程、PR 正文按模板、由审查代理审查。

## 2. 验收

- [x] 2.1 O1：植入缺陷，范围模式审查，报出 Important 且指向该行；核对没有写 GitHub。
- [x] 2.2 O2 本地部分与 O5，推送开 PR（正文按模板）。
- [x] 2.3 开 `required_conversation_resolution`，读回（O4 前半）。
- [x] 2.4 O3：审查代理审第一轮，回应并解决每条发现，按 D6 决定是否再审；O4 后半。
- [ ] 2.5 验收记录写进 design.md；两个检查绿后合并（D8）。验收记录已写；第三轮仍有 Important，按 D6 停下，合并交给用户。

## 3. 归档

- [x] 3.1 同步主规格并归档，与验收记录同一个提交。
