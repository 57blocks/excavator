## 1. 先验装置（先红）

- [x] 1.1 在 `tests/skill/excavator/test_validate_graph.test.mjs` 加夹具与用例：被 `@Override` 注解的方法、三行注解且参数多行并夹一行注释的类、一个 20 行以上的注解块（嵌套注解、字符串字面量里含 `@`、`(`、`\n`，自行构造，不照搬真实源码）、TS/Python 装饰器、C# 属性、Rust 属性；链式调用（行尾 `.` 与行首 `.` 两种）、10 行 builder 链、链中间夹 lambda 块后 callee 在块之后（`.map(x -> {…}).collect(…)`）、callee 只在下一条语句里的反例。先在未改代码上跑，确认这些误报用例红、假样本用例绿，证明装置看得见（记录失败输出）。红只在本地确认，不单独提交
- [x] 1.2 加「宽容不外溢」的反例用例：锚点错位五行进方法体、注解后跟另一个名字的声明、证据行指向无关语句、模型引用（`source: "model"`）的 callee 在下一行、改错被调用者名。它们在新旧代码上都必须报出（现在即绿，作为护栏）
- [x] 1.3 改写原先「其余类型只看证据行」的 `keeps the single-line rule for every other edge type` 用例，使其只约束仍应保持单行的情形（模型引用的证据、`mentions` 等带 `token` 的类型）

## 2. 锚点与成员边

- [x] 2.1 在 `validate-graph.mjs` 加 `skipLeadingLines`（空行、注释、`@` / `#[` / C# 属性、括号配平、字符串内括号不计、`CONSTRUCT_SCAN_LINES`），锚点检查改为「起点 ±1 或前导行之后那一行」，过长标 `unverified` 并计 `constructTooLong`；验证 1.1 的锚点用例转绿、1.2 的锚点护栏仍绿
- [x] 2.2 证据检查对抽取器写的证据（`source !== 'model'`）先试原行再试前导行之后那一行，类型无关；验证 `contains` / `exports` / `implements` / `overrides` 的 1.1 用例转绿、`routes` 与带 `token` 的 `contains` 原用例不变

## 3. `calls` 的整条表达式

- [x] 3.1 加 `findTokenInExpression`（括号配平、行尾 / 行首续行、顶层 `;`、逐行先查 token、超限返回过长），`calls` 且非模型引用时使用；验证 1.1 的链式用例与 10 行 builder 链转绿、callee 在下一条语句里的反例仍为 contradicted、JSX `token` 用例不变
- [x] 3.2 过长结构的用例：400 行以上没有终止符的表达式 → `unverified`、缺口 `construct-too-long` 有计数与样例、`edge-contradicted` 为 0；同一路径上节点同理。验证用例通过
- [x] 3.3 `skills/excavator/SKILL.md` Phase 6b 的检查说明改为与规格一致；验证 `node scripts/check-refs.mjs` 通过

## 4. 报告与确定性

- [x] 4.1 报告输出 `counts.constructTooLong` 与缺口 `construct-too-long`（0 时不出），保持排序与确定性；验证既有 CLI 用例（确定性报告、退出码）仍通过，并新增一条含过长结构的 CLI 用例

## 5. 真实图验收（oracle 已写死，动手前不改）

- [x] 5.1 用保存下来的那次冒烟的图与源码（74 文件 Java 子项目，在部署主机的运行输出与仓库目录里，通过 SSM 只读取回到 scratchpad；源码与图都不进仓库）重新验证。判据：按机制分组的六类（`contains` 530、`exports` 242、`implements` 40、`overrides` 10、锚点 47、`calls` 50）各自归零；任何残余逐条给出源码证据，证明不是机制漏判，且残余不超过 5 条。`constructTooLong` 的计数写进验收记录
- [x] 5.2 召回：在同一克隆里按种子植入 ≥ 200 个假样本（锚点错位 3–30 行、证据行改指相邻语句、证据行改指一个含 lambda 块的语句而 callee 是块内另一次调用、被调用者名改错、`contains` 证据行指向别的成员的注解），重放决定，要求全部仍为 contradicted，且「植入数 = 报出数」守恒；离开此守恒必须写明原因。同一植入脚本先在旧验证器上跑，确认旧验证器也全部报出（装置对照）
- [x] 5.3 记录验收结果与残余到 `acceptance.md`（只写机制与规模，不写语料名）

## 6. 门与合并

- [ ] 6.1 `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`，并 `node scripts/check-refs.mjs`，`openspec validate --all --strict`；新文件先 `git add -N` 再跑门
- [ ] 6.2 分阶段 commit：每个 commit 带自己的测试与实现且单独为绿（1.2 的护栏用例与 1.3 的改写随第一个实现 commit，1.1 的各夹具随其对应的 2.x / 3.x / 4.x commit）；每个 commit 前逐个核对 `--stat` 文件数；PR 用 `--merge`；归档前做 spec 同步

## 7. 评审第 1 轮（PR 评审后追加）

- [x] 7.1 评审的两条 Important 与一条 Nit 先写成用例复现（Python `import` 行被当声明头、Go `count--` 被当续行、数组行被当 C# 属性），在原代码上红；同类的可空类型 `?`、块注释结尾也一并复现。修复后用例转绿，且 `calls` 不再做跳前导行
- [x] 7.2 真实图验收重跑：基线仍为 0，非 lambda 植入 260/260，新版无多报
