## Context

分层有两个写出方：
- Full 运行的 Phase F3 用 `semantic-graph.mjs` 写 `.excavator/semantic-graph.json`：`layers[]`（每个 {id, name, description, nodeIds[]}）与 `factDigest`，后者是写出时图谱的 `project.factsDigest`。查看器（`skills/excavator-view/semantics.mjs`）只在 `factDigest` 等于图谱的 `factsDigest` 时用这些分层。
- 增量更新的 `finalize-incremental.mjs` 把分层放进图谱，`knowledge-graph-store.mjs` 把每个分层写成一行 `{"record":"layer","layer":…}`，紧凑 JSON，没有空格。Lazy 的 `lazy-analyze.mjs` 只保留已有的分层（`existing?.layers ?? []`）。

图谱文件头写 `counts`，其中 `layers` 是分层行的个数；`fields.project.factsDigest` 是当前事实的摘要。分层的 `nodeIds` 只列文件级节点（`agents/excavator-architecture-analyzer.md` 的输出契约：每个文件级节点恰好落在一个分层里）。

四个 skill 用 Grep 读图谱，取分层的一步写的是 `"layers"`，只命中文件头。

## Goals / Non-Goals

**Goals：**
- 四个 skill 从分层实际所在处取分层，与查看器同一个判据；
- 没有可用的分层时照实说，不自行分组；
- 一个契约测试，跑 skill 自己写的命令，在任何读图谱的 skill 回到 grep `"layers"`、丢掉 `semantic-graph.json` 或丢掉没有分层时的规则时变红。

**Non-Goals：**
- 不改存储格式与 `semantic-graph.json`；
- 不为 skill 加读分层的脚本：两个摘要比较加一条 `jq` 或 `grep`，skill 足够（AGENTS.md 的 AI-first scope gate）；四份散文的漂移由测试守住（D3）；
- 不改四个 skill 的其他步骤。

## Decisions

### D1 从哪里取分层

按顺序取第一个适用的：
1. `semantic-graph.json` 存在，且它的 `factDigest` 等于图谱文件头的 `fields.project.factsDigest`：用它的分层。
2. 否则，图谱有 `"record":"layer"` 行：用这些行。
3. 否则没有可用的分层：照实说，不按目录或文件名自行分组。没有出处的分层是编造。

`semantic-graph.json` 存在但 `factDigest` 不同：不用它的分层，照实说它们来自别的事实，建议运行 `/excavator --mode=full`。与查看器的判据一致：过期的分层可能指向已不存在的节点，或漏掉新文件。

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
- 检查能失败：任一 skill 把取分层的一步改回 grep `"layers"`、删掉没有分层时的措辞、删掉 `semantic-graph.json`，检查都报出问题。

### D5 规格放在 `fact-graph`

要求关于的是读图谱的 skill 怎样取分层，涉及 `fact-graph` 的记录格式与 `full-semantic-isolation` 的语义产物；放在 `fact-graph`，正文引用后者。onboard、explain、diff 的能力规格由各自的回复语言变更新建，不在这里再建。

## 验收 oracle（动手前写死；审查第 1 轮后改为 D1–D4 的版本）

- **O1：** 在改 skill 之前，新测试对四个 skill 都是红的。改完后全绿。
- **O2：** D4 三种产物情形下，每条命令的输出与 D4 所列一致。
- **O3：** D4 的「检查能失败」三种改法，四个 skill 各自都报出问题。
- **O4：** `node scripts/check-refs.mjs`、`pnpm test`、`openspec validate --all --strict` 通过。
- **O5：** 四个 SKILL.md 的 diff 只含 Reading Layers 一节、分层行的说明、取分层的一步，onboard 另加 Architecture Layers 一行，其余措辞逐字不变。

## Risks / Trade-offs

- 契约测试只认加粗标题含 layer 的编号步骤。将来改标题去掉 layer，测试会因为「恰好一个」而变红，不会静默放过。
- 测试证明 skill 写的命令在真实产物上取到规则所说的输入，不证明模型照规则做；照做与否要真实运行看。
- 语义图当前但分层为空时，规则 1 适用，不再看分层行。两处同时有分层只会出现在 Full 之后又做增量更新的项目上，那时语义图的 `factDigest` 已经过期，规则 2 适用。
