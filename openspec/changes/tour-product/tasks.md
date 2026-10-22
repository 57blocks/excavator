## Commit 序列

0. `docs(openspec): propose tour-product`：本变更的文件。
1. `feat(tour): candidate set from the graph, semantics, layers and domain flows`（1.1–1.2）。
2. `feat(tour): structure check, sentence slices and verdicts`（2.1–2.3）。
3. `feat(tour): /excavator-tour skill, verifier agent and the tour product`（3.1–3.3）。
4. `docs(openspec): record tour-product acceptance and archive`（4.1–4.4）。

每个 commit 自带测试，单独通过 O2。

## 1. 候选集

- [ ] 1.1 `skills/excavator/tour.mjs candidates`（design D1、D2）：读图谱 jsonl、语义缓存、语义图、领域图；算入口候选、文件级扇入扇出、BFS、每层前 5、flow 锚点、非代码节点；每个候选带摘要、结论、层与入选原因；写明各类总数与截掉的数目。摘要规则直接调用 `skills/excavator-view/semantics.mjs`。验证：O1 候选集各条先红后绿。
- [ ] 1.2 缺图谱时非零退出；没有语义文件时摘要取图谱节点；领域图 different revision 时不取 flow。验证：单测。

## 2. 校验、切句与结论

- [ ] 2.1 `check <draft>`：结构规则（spec「导览的结构」），失败时逐条列出问题并非零退出。验证：O1 `check` 各条先红后绿。
- [ ] 2.2 `slices <draft>`：切句编号，截取片段（每节点 120 行、每步 400 行，截断写明），每步写一个核验输入文件。验证：单测覆盖切句、编号与截断。
- [ ] 2.3 `verdicts`：回填结论，缺结论为 `unchecked`；第一轮列出要改写的步；第二轮删句、删步、重新编号、写 `removed`。验证：O1 `verdicts` 各条先红后绿。

## 3. skill、核验代理与产物

- [ ] 3.1 `report`：写 `.excavator/tour.json`（spec「导览产物」），原子写、确定性；打印回复的几行。验证：O1 `report` 各条。
- [ ] 3.2 `agents/excavator-tour-verifier.md`（design D3）：只读一步的句子与片段，输出每句结论与理由的 JSON。登记进插件清单。验证：`claude plugin validate` 与 `check-refs` 通过。
- [ ] 3.3 `skills/excavator-tour/SKILL.md`（design D6）：流程、语言段落、派发规则、最后回复由最后一条命令打印。验证：契约测试检查语言段落、最后命令与无建议性措辞。

## 4. 验收

- [ ] 4.1 O2 全量门。
- [ ] 4.2 O1 注入变异逐一先红后绿，记录结果。
- [ ] 4.3 O3：go-multirepo 克隆上 `claude -p --model sonnet` 真实运行，独立验收代理核对与分层抽查。
- [ ] 4.4 O4 `--language zh` 一次；在 design.md 末尾写验收记录，同步主规范，归档本变更。
