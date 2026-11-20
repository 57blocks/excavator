# 验收记录：node-display-name

日期：2026-11-20。分支 `docs/node-display-name`，实现提交 `10de4d0d` 到 `73b2e39f`。

## 先验装置（Oracle 1 到 9）

新用例都先在未改的代码上跑过，确认为红：

- Oracle 1 到 6（语义缓存形状门、六种拒绝输入、审计路径、版本 `2.0.0` 判非规范、三处字段清单一致、MCP 提交）：`tests/semantic-cache/display-name.test.mjs`、`tests/full/apply-semantic-patches-display-name.test.mjs`、`tests/mcp/display-name-commit.test.mjs`，21 条在旧代码上全红。其中一条起初为绿，补上对 `displayName` 的断言后变红。
- 评审中补的一条：模型补丁自带的 `verification` 不得进缓存。它在旧代码上本来就成立（旧代码手写字段清单），在改用单一字段清单的中间版本上为红，修复后为绿。
- Oracle 7（核验批次带名称；`contradicted` 后页面数据里摘要与名称都为空）：`tests/full/apply-verification-semantic.test.mjs`、`tests/skill/excavator/test_apply_verification.test.mjs`、`tests/skill/excavator-view/pack-semantics.test.mjs`、`tests/skill/excavator-view/explorer-pack.test.mjs` 的新用例，旧代码上为红。
- Oracle 8（Lazy 重投影保留名称）与图模式核对：`tests/lazy/display-name-graph-path.test.mjs` 三条为红；“合法名称不报问题”一条是否定检查，旧代码上自然为绿。
- Oracle 9（页面数据行形状）：`pack-semantics.test.mjs` 的行形状用例为红。
- 提示词：`tests/skill/excavator/test_display_name_prompts.test.mjs` 各条在改提示词前为红。
- explorer：`packages/explorer/src/__tests__/displayName.test.ts` 在旧代码上因 `nodeTitle` 不存在而红。

## 变异

每次只改一处，跑针对它的用例，再从 HEAD 还原该文件；11 处全部至少使一条用例变红：去掉形状核对、审计不含 `displayName`、补丁应用丢掉名称、补丁应用带上模型自己的 `verification`、版本不升、核验候选不带名称、页面数据行在 `contradicted` 时保留名称、explorer 合并在 `contradicted` 时保留名称、Lazy 重投影丢名称、图核对跳过名称、MCP schema 缺 `displayName`。

## 门

- 受影响范围：凡提到被改模块的测试文件，加 `tests/refs`、`tests/language`，共 94 个文件、1,976 条用例通过；explorer 包 44 个文件、396 条通过。
- `typecheck` 无错误；`check-refs` OK；`openspec validate --all --strict` 66/66。
- 全量交 CI gate。

## 真实运行

语料：每个 PR 的机制冒烟语料，一个 49 个文件的 Go 后端服务。Full 模式，Sonnet，同一语料先在 `main`（`91ad4f9d`）上跑基线，再在本分支上跑。

| 运行 | 用时 | 花费 | 输出 token | 被核验摘要 | contradicted |
|---|---|---|---|---|---|
| 基线 | 3 分 21 秒 | $2.72 | 46,360 | 180 | 8（4.4%） |
| 本变更 | 4 分 6 秒 | $2.54 | 46,488 | 180 | 10（5.6%） |

- 判据 1：缓存版本 `3.0.0`，229 个条目全部带有通过核对的 `displayName`；229 个补丁全部提交，各拒绝桶计数为 0。达标。
- 判据 2：contradicted 比例增加 1.2 个百分点（上限 5）。达标。10 条理由中 2 条点名名称（1 条只有名称错，1 条名称与摘要都错），8 条只关于摘要；两次运行的 contradicted 集合只有 4 个节点重合，差异在运行间波动之内。
- 判据 3：固定种子分层抽 30 个（文件 10、处理函数 10、其他函数与类 10；语料没有路由边，处理函数取 `handlers/` 目录下的函数），主会话逐个读源码。错归属 0/30。一个名称偏宽：只按邮箱查在职员工的函数被叫作“员工 Google 登录”，是照代码名改写；它的摘要被判 contradicted，页面会把摘要与名称一起置空。另有两个节点（接口与它调用的服务方法）同名“刷新令牌”。达标。
- 判据 4：整次运行的输出 token 增加 0.3%（上限 15%）。运行输出只给整次用量、不分阶段，整次的增量是语义阶段增量的上界。达标。

## 局限

- 判据 3 只抽了 30 个，只覆盖一种语言的一个语料。
- 名称的业务措辞质量（是否足够“产品化”）没有量化判据，只核对了不说错。
- 图模式路径（GraphNode 直接写名称）只有单元测试，真实运行走的是 Full 的补丁路径。

## 评审第一轮之后

评审（0 Important、2 Nit、1 Pre-existing）与自查后的改动，每处先写用例、在改动前的代码上为红：

- MCP `recall` 与 Chat 的语义缓存命中规则读 `displayName`（proposal 承诺过，任务清单漏列）。
- `WRITER_FIELDS`：可缓存字段去掉 `verification`。Full 补丁、MCP `semantic_commit` 的 schema、项目服务与 `semantic_plan` 的约束都用它；调用方自带的核验结论被拒绝，不写缓存。这一处是评审指出的既有问题：MCP 原来就接受调用方的结论，本变更之后它会让名称也绕过核验。
- `semantic_plan` 的复用行带 `displayName`：复用的节点不会再生成，不带就拿不到名称。
- 文件分析器的节点字段清单在冻结的上游前缀里，不能改；追加的 Display Name 一节写明它把 `displayName` 加进必填字段、`name` 仍是代码名。

变异：调用方结论放行、写入字段含 `verification`、复用行丢名称、recall 不读名称，4 处全部至少使一条用例变红。受影响范围 164 个文件、3,531 条用例通过。

## 评审第二轮之后

评审（0 Important、0 Nit、1 Pre-existing）指出 Chat 直接调用 `commitSemanticCacheEntry`，仍能带上自己的 `verification`。核对改到这个提交函数里：带 `verification` 的写入整条拒绝为 `rejected-fields`，覆盖 Full 补丁、MCP 与 Chat；读取已存条目的校验不变（已存条目合法地带着核验结论）。先写的用例在改动前为红；去掉这处核对的变异使 2 条用例变红。受影响范围 164 个文件、3,532 条用例通过。
