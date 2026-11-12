## 背景

- 第二次真实运行的第一段：编排者每写一批功能就报一次花费，第 4 批后说「剩余预算已不够写完全部 68 个功能，我会优先保证核心业务功能，并为后续阶段预留预算」。它在 27 个功能检查完的同一条消息里就开始读数据阶段的文件。
- 排序、对策、专题的状态记着输入的摘要；功能补齐后摘要变了，这三段整段重做。
- 花费上限是运行的人给的（`--max-budget-usd`），技能管不了；技能能管的是「功能没写完就不进入后面的阶段」。

## 决定

### D1 后面阶段的门

- 门放在四条事实命令里：`priority-items`、`remedy-facts`、`topic-lanes`、`outline-facts`。它们是各自阶段的第一步，阶段文字已经规定「退出 1：照念并停下」，所以门不依赖编排者记得什么。
- 「功能阶段开始过」：`state.json` 里有一个功能单元或问题单元的 `attempts` 大于 0。没开始过时不拦：只选了 `priority` 之类的运行照旧。
- 「没写完」：在本次的功能里（`--features "<ids>"` 给出的，不给时是地图的全部功能），一个功能单元是 `planned`、`dispatched`，或 `failed` 且 `attempts` 小于 2；问题单元在问题阶段开始过时按同样规则看。`attempts` 为 2 的 `failed` 是终态，不拦。
- 退出 1 时打印两行：`Features not written: <ids>`（按地图顺序，问题单元写成 `<id>.findings`），以及 `Next: go back to Phase 4, write these lanes, then run this command again`。阶段文字把这一行与其它退出 1 分开：遇到它就回到 Phase 4，而不是停下。
- 代价：四条命令的调用要多传一个 `--features`。漏传时按全部功能算，只会多拦、不会漏拦；`--features` 是本次运行已有的 `$SELECTED`，不是新的判断。
- 不另做「本次运行选了哪些功能」的落盘：选中列表只由 `select` 算出，落盘就要多一种状态，并且要处理它与续跑参数不一致的情况。

### D2 提示词里的一句

- `sections/features.md` 步骤 1 后加一句：为步骤 1 列出的每个功能派发；不要为了给后面的阶段留预算或时间而少写功能，也不要把功能留到手册里注明没写；跑不下去就停，下一次运行从状态续上，不重复已写的部分。
- 这句话本身拦不住，门才拦得住；这句话减少「走到门前被退回」的次数。

### D3 单字的非 ASCII 词

- `check-ui` 对 `md.findings.adviceWords` 与 `md.findings.scopeWords` 的每个词：含 ASCII 以外字符、且只有一个字符（按 Unicode 码点数）时报告 `ui.json: <key>: "<word>" is a single character; in a script without spaces it matches inside longer words, write words of two or more characters`。
- 选择在检查里拒绝，而不是在匹配时静默丢掉：丢掉是看不见的，拒绝会让第 2 阶段重新翻译。
- 不建按语言的固定词表：词表跟着固定文字一起翻译，是现有的设计。

## Oracle

- **O1 门（脚本测试）**，四条命令都测：
  - 功能阶段没开始过：退出 0（与改动前同）。
  - 有功能 `checked`、有功能 `planned`：退出 1，列出 `planned` 的功能与 `Next:` 行。
  - `dispatched` 的功能、`failed` 且 `attempts` 1 的功能：拦；`failed` 且 `attempts` 2：不拦。
  - 问题单元 `planned` 而功能都已写完：拦，写成 `<id>.findings`。
  - `--features` 只给已写完的功能：不拦。
  - 换回改动前的命令，拦的那几例要变红。
- **O2 词表**：`应` 被拒，`应该` 通过；英文表照旧通过。测试源码里的中文用 `String.fromCharCode` 写，源码零非 ASCII。
- **O3 合约**：`features.md` 含 D2 的句子；四个阶段文件的命令带 `--features`，并写明遇到 `Next: go back to Phase 4` 时回到 Phase 4。
- **O4 真实运行**：同一私有语料再跑一次全量：排序、对策、每路专题的首次派发各只有一次（重派另计）；没有因「应」之类单字词出的建议提示；记花费与时长。
- **O5**：受影响测试、`typecheck`、`openspec validate --all --strict`、零非 ASCII、名字扫描。
