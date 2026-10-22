## Context

`skills/excavator/knowledge-graph-store.mjs` 是图谱唯一的读写模块。它把 `layers` 数组的每个元素写成一行 `{"record":"layer","layer":…}`，紧凑 JSON，没有空格；文件头写 `counts`，其中 `layers` 是分层的个数。分层的 `nodeIds` 只列文件级节点（`agents/excavator-architecture-analyzer.md` 的输出契约：每个文件级节点恰好落在一个分层里）。Lazy 图谱只有确定性事实，分层可以为空。

四个 skill 用 Grep 读图谱，取分层的一步写的是 `"layers"`。

## Goals / Non-Goals

**Goals：**
- 四个 skill 取分层的一步读得到分层记录；
- 一个契约测试，在任何读图谱的 skill 回到 grep `"layers"` 时变红。

**Non-Goals：**
- 不改存储格式，也不为 skill 加读分层的脚本：一次 Grep 就能取到，skill 足够（AGENTS.md 的 AI-first scope gate）；
- 不改四个 skill 的其他步骤。

## Decisions

### D1 取分层的写法

- 取全部分层：grep `"record":"layer"`。这是存储模块写出的字面，和 How to Read Efficiently 里 `grep '"record":"node"'` 的写法一致。
- 查一个节点的分层：在分层行里找带引号的节点 ID。引号让 `"file:src/a.ts"` 不会命中 `file:src/a.tsx`。
- 分层只列文件级节点：explain 的目标、chat 的节点是函数或类时，用同一 `filePath` 的文件级节点 ID；diff 第 4 步按 `filePath` 找到的节点已含文件级节点，照原文用匹配到的 ID 即可，补一句说明哪些会命中。
- 没有分层行命中：照实说图谱没有给出分层。onboard 的 Architecture Layers 一节在这种情况下写明，不按目录自行分组。没有出处的分层是编造。

### D2 契约测试

`tests/skill/test_graph_skill_layer_step.test.mjs`：
- 读图谱的 skill 由文件内容决定：`skills/*/SKILL.md` 中写了 `{"record":"layer","layer":` 的那些。测试钉住这个集合至少含 onboard、chat、diff、explain，免得发现规则失效时零个 skill 也算通过。
- 取分层的一步：`## Instructions` 到下一个 `##` 或 `###` 标题之间，加粗标题含 layer 的编号步骤；必须恰好一个。
- 每个 skill 的检查：这一步写 `"record":"layer"`；整份 skill 不出现 `"layers"`（任何一步 grep 它都只得到文件头）。
- 用存储模块写一张小图（两个分层，各含 `file:src/a.ts` 与 `file:src/a.tsx`）：
  - 含 `"record":"layer"` 的行恰好是两条分层记录，解析后与写入的分层相等；
  - 含 `"layers"` 的行只有文件头，证明旧写法拿不到分层；
  - 分层行里含 `"file:src/a.ts"` 的恰好是第一个分层。
- 检查能失败：把每个 skill 里的 `` `"record":"layer"` `` 换回 `` `"layers"` ``，检查必须报出问题。

### D3 规格放在 `fact-graph`

要求关于的是图谱的记录格式怎样被读，`fact-graph` 已有「图谱持久化……」一条规定这个格式。onboard、explain、diff 的能力规格由各自的回复语言变更新建；放在 `fact-graph` 也避免两个变更新建同一个规格文件。

## 验收 oracle（动手前写死）

- **O1：** 在改 skill 之前，新测试对四个 skill 都是红的，每个都报两条：取分层的一步没写 `"record":"layer"`，整份 skill 出现 `"layers"`。改完后全绿。
- **O2：** D2 的「检查能失败」一例在改完后仍然成立：四个 skill 各自换回旧写法都报出问题。
- **O3：** `node scripts/check-refs.mjs`、`pnpm test`、`openspec validate --all --strict` 通过。
- **O4：** 四个 SKILL.md 的 diff 只含 D1 的那几行，其余措辞逐字不变。

## Risks / Trade-offs

- 契约测试只认加粗标题含 layer 的编号步骤。将来改标题去掉 layer，测试会因为「恰好一个」而变红，不会静默放过。
- 测试证明的是 skill 写的模式命中存储模块写出的行，不证明模型照做；照做与否要真实运行看，本变更的改动是一个 grep 目标，不做真实运行。
