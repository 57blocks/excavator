## Context

分层有两个写出方：
- Full 运行的 Phase F3 用 `semantic-graph.mjs` 写 `.excavator/semantic-graph.json`：`layers[]`（每个 {id, name, description, nodeIds[]}）与 `factDigest`，后者是写出时图谱的 `project.factsDigest`。查看器（`skills/excavator-view/semantics.mjs`）只在 `factDigest` 等于图谱的 `factsDigest` 时用这些分层。
- 增量更新的 `finalize-incremental.mjs` 把分层放进图谱，`knowledge-graph-store.mjs` 把每个分层写成一行 `{"record":"layer","layer":…}`，紧凑 JSON，没有空格。Lazy 的 `lazy-analyze.mjs` 只保留已有的分层（`existing?.layers ?? []`）。

两个摘要不说明哪一处是后写的：
- `finalize-incremental.mjs` 用展开上一次的 `project` 来写文件头，`factsDigest` 不变；增量路径上没有任何一步写 `semantic-graph.json`。Full 之后再做增量更新，两个摘要相等，分层行却是后写的：新文件只在分层行里（没有旧分层时全部归入 `layer:other`），删掉的文件还在语义图的分层里。
- `lazy-analyze.mjs`（Lazy 运行与 Full 的 F1）从头组装 `project`，只带它列出的字段，却把已有的分层行原样带过去。之后 F3 重写语义图，两个摘要相等，语义图是后写的。

图谱文件头写 `counts`，其中 `layers` 是分层行的个数；`fields.project.factsDigest` 是当前事实的摘要。分层的 `nodeIds` 只列文件级节点（`agents/excavator-architecture-analyzer.md` 的输出契约：每个文件级节点恰好落在一个分层里）。

四个 skill 用 Grep 读图谱，取分层的一步写的是 `"layers"`，只命中文件头。

## Goals / Non-Goals

**Goals：**
- 四个 skill 从分层实际所在处取分层，与查看器同一个判据；
- 没有可用的分层时照实说，不自行分组；
- 一个契约测试，跑 skill 自己写的命令，在任何读图谱的 skill 回到 grep `"layers"`、丢掉 `semantic-graph.json` 或丢掉没有分层时的规则时变红。

**Non-Goals：**
- 不改存储格式与 `semantic-graph.json`；文件头的 `project` 只多一个字段（D6）；
- 不为 skill 加读分层的脚本：两个摘要比较加一条 `jq` 或 `grep`，skill 足够（AGENTS.md 的 AI-first scope gate）；四份散文的漂移由测试守住（D3）；
- 不改四个 skill 的其他步骤。

## Decisions

### D1 从哪里取分层

按顺序取第一个适用的：
1. 图谱文件头的 `fields.project.layersFrom` 是 `incremental`（D6）：用图谱的 `"record":"layer"` 行。增量更新从不写 `semantic-graph.json`，所以这些行是最后写出的分层。
2. 否则，`semantic-graph.json` 存在，且它的 `factDigest` 等于图谱文件头的 `fields.project.factsDigest`：用它的分层。
3. 否则，图谱有分层行：用这些行。
4. 否则没有可用的分层：照实说，不按目录或文件名自行分组。没有出处的分层是编造。

规则 1 或 3 适用而 `semantic-graph.json` 存在：不用它的分层，照实说它们比分层行旧或来自别的事实，建议运行 `/excavator --full`。规则 2 不带 `layersFrom` 时与查看器的判据一致：过期的分层可能指向已不存在的节点，或漏掉新文件。

建议的命令是 `/excavator --full`，不是 `/excavator --mode=full`：后者在已有图谱的项目上按决策表走「询问」或增量路径，不重写 `semantic-graph.json`；`--full` 总是走 Phase F，F3 重建分层（`skills/excavator/SKILL.md` 的决策表；查看器对过期语义的提示 `skills/excavator-view/products.mjs` 也是 `--full`）。

### D2 查一个节点的分层

- 精确字符串匹配：`semantic-graph.json` 用 `jq --arg id … '.layers[] | select(.nodeIds | index($id))'`；分层行用 `grep -F` 加引号的 ID。Grep 工具按正则匹配，`file:app/[id]/page.tsx` 这样的 ID 会落空；引号让 `"file:src/a.ts"` 不会命中 `file:src/a.tsx`。
- 分层只列文件级节点：函数或类用同一 `filePath` 的文件级节点 ID。diff 第 4 步按 `filePath` 找到的节点已含文件级节点。

### D3 一节相同的 Reading Layers

规则与命令写在每个 skill 的 `## Reading Layers` 一节里，放在 How to Read Efficiently 之后、Instructions 之前，四个 skill 逐字相同。取分层的一步只指向这一节。Graph Structure Reference 的分层行注明 Full 的分层在 `semantic-graph.json`。

### D4 契约测试

`tests/skill/test_graph_skill_layer_step.test.mjs`：
- 读图谱的 skill 由文件内容决定：`skills/*/SKILL.md` 中写了 `{"record":"layer","layer":` 的那些。测试钉住这个集合至少含 onboard、chat、diff、explain，免得发现规则失效时零个 skill 也算通过。
- 每个 skill：有 Reading Layers 一节，它写了 `semantic-graph.json`、`factDigest`、`"record":"layer"` 与没有分层时的固定措辞；Instructions 里加粗标题含 layer 的编号步骤恰好一个，且指向这一节；整份 skill 不出现 `"layers"`。
- 四个 skill 的这一节逐字相同。
- 跑这一节 bash 块里的每条命令，节点 ID 填 `file:src/a.ts` 或 `file:app/[id]/page.tsx`，产物由存储模块与 `semantic-graph.mjs` 写出：
  - 当前的语义图（图谱没有分层行）：两个摘要相同；`jq` 列出语义图的分层，按节点只得到它自己的分层；
  - 过期的语义图加分层行：两个摘要不同；`grep` 得到全部分层行，按节点只得到它自己的分层，`file:src/a.ts` 不命中 `file:src/a.tsx`；
  - 两处都没有：没有 `semantic-graph.json`，`grep` 没有输出。
- 真实流水线（评审第 2 轮）：一个 git 仓库，`lazy-analyze.mjs` 加 `semantic-graph.mjs write`（Full），新提交加一个文件后 `prepare-incremental.mjs` 加 `finalize-incremental.mjs`（增量更新），再 `lazy-analyze.mjs` 加 `semantic-graph.mjs write`（再一次 Full）。测试把这一节「取第一个适用的」列表照字面实现成一个函数，喂给它命令的输出：
  - Full 之后：没有 `layersFrom`，两个摘要相等，选语义图；
  - 增量更新之后：两个摘要仍相等（复现 `finalize-incremental.mjs` 实际写出的），`layersFrom` 是 `incremental`，选分层行，按新文件只得到列出它的分层；
  - 再一次 Full 之后：`layersFrom` 没有了，分层行还在，两个摘要相等，选语义图。
- 检查能失败：任一 skill 把取分层的一步改回 grep `"layers"`、删掉没有分层时的措辞、删掉 `semantic-graph.json`、把 `layersFrom` 一条挪到摘要比较之后，检查都报出问题。

### D5 规格放在 `fact-graph`

要求关于的是读图谱的 skill 怎样取分层，涉及 `fact-graph` 的记录格式与 `full-semantic-isolation` 的语义产物；放在 `fact-graph`，正文引用后者。onboard、explain、diff 的能力规格由各自的回复语言变更新建，不在这里再建。

### D6 写入先后的判据：`layersFrom`

`finalize-incremental.mjs` 在写分层行的分支（`PARTIAL_UPDATE` 与 `ARCHITECTURE_UPDATE`）给文件头的 `project` 加 `layersFrom: "incremental"`。这个判据是确定性的，靠的是两个写出方已有的行为：
- 增量更新展开上一次的 `project`，所以连续几次增量更新都保留它；`SKIP` 不改分层，也只展开上一次的 `project`，保留与否随上一次；
- `lazy-analyze.mjs` 从头组装 `project`，只带它列出的字段，所以 Lazy 运行与 Full 的 F1 都去掉它。之后 F3 写出的语义图就是最后写出的分层。

否决的做法：
- 分层行优先：Lazy 把旧的分层行带过下一次 Full，那时语义图才是新的（评审第 2 轮）。
- 比较时间（`project.analyzedAt` 与语义图的 `generatedAt`）：依赖时钟；F3 走 `reuse` 分支时 `generatedAt` 不更新，而 F1 刚改过 `analyzedAt`。
- 比较提交（`project.gitCommitHash` 与语义图的 `sourceSnapshot`）：同样被 `reuse` 分支打破，非 git 目标没有提交。
- 让增量更新改写或删掉 `factsDigest`：查看器、`project-service.mjs` 与 F3 的判据都读它，影响面超出读分层的 skill。

`ProjectMetaSchema` 是 passthrough，多一个字段不影响读图谱的代码。这个字段出现之前写出的增量图谱没有它，规则 2 仍会选中语义图，直到下一次增量更新。

## 验收 oracle（动手前写死；审查第 1 轮后改为 D1–D4 的版本）

- **O1：** 在改 skill 之前，新测试对四个 skill 都是红的。改完后全绿。
- **O2：** D4 三种产物情形下，每条命令的输出与 D4 所列一致。
- **O3：** D4 的「检查能失败」三种改法，四个 skill 各自都报出问题。
- **O4：** `node scripts/check-refs.mjs`、`pnpm test`、`openspec validate --all --strict` 通过。
- **O5：** 四个 SKILL.md 的 diff 只含 Reading Layers 一节、分层行的说明、取分层的一步，onboard 另加 Architecture Layers 一行，其余措辞逐字不变。
- **O6（审查第 2 轮）：** D4 的真实流水线测试在第 1 轮的 skill 上（`finalize-incremental.mjs` 已写 `layersFrom`）是红的，增量更新之后那一步选中的是语义图；改完 skill 后全绿。三步里每一步选中的来源与 D4 所列一致。
- **O7（审查第 2 轮）：** `finalize-incremental.mjs` 只在写分层行的分支写 `layersFrom`；`SKIP` 分支与 `lazy-analyze.mjs` 的输出不变。

## Risks / Trade-offs

- 契约测试只认加粗标题含 layer 的编号步骤。将来改标题去掉 layer，测试会因为「恰好一个」而变红，不会静默放过。
- 测试证明 skill 写的命令在真实产物上取到规则所说的输入，不证明模型照规则做；照做与否要真实运行看。
- 语义图当前但分层为空时，规则 2 适用，不再看分层行。
- Full 之后的 `PARTIAL_UPDATE`：图谱里还没有分层行，`finalize-incremental.mjs` 把所有文件归入 `layer:other`，规则 1 选中的就是这一个分层。它是最后写出的，照规则用它；Full 的分层不传给增量更新是写出方的问题，不在本变更范围内。
- `layersFrom` 出现之前写出的增量图谱：见 D6 末段。
