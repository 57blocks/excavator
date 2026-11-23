## ADDED Requirements

### Requirement: F2 按要读的源码行分批

Phase F2 SHALL 由确定性脚本从 `plan.generate` 装批，MUST NOT 由编排者拼节点清单。每个节点 SHALL 有一个要读的行范围 `readRange`：有 `lineRange` 用它，没有的用文件前 300 行；读不到或为空的文件上的节点 SHALL 进可见的 `unreadable` 桶，不派发。

- 每批 SHALL 不超过节点数上限（默认 40）与要读的行上限（默认 1,500，同一文件内按 `readRange` 的并集计）。
- 单个节点自己超过行上限时 SHALL 独占一批，并标为 oversized。
- 每批 SHALL 有一个输入文件，列出本批节点的 `{id, type, name, filePath, lineRange?, readRange}`。

#### Scenario: 一个大目录拆成多批
- **WHEN** `plan.generate` 有 300 个节点，分布在总计上万行的文件里
- **THEN** 每批不超过 40 个节点、要读的行不超过 1,500；所有节点恰好出现在一批里或 `unreadable` 桶里

#### Scenario: 超长的单个节点
- **WHEN** 一个函数的 `lineRange` 跨 2,000 行
- **THEN** 它独占一批，该批标为 oversized，别的节点不进这一批

### Requirement: 语义补丁带读过的行

每个语义补丁 SHALL 带 `evidence: {line, quote}`。提交脚本 SHALL 读源码核对：`line` 在节点的 `readRange` 里；节点有多行 `lineRange` 时 `line` MUST NOT 是它的第一行；`quote` 含字母或数字、去掉空白后不少于 `min(8, 该行去掉空白后的字符数)` 个字符，且空白折叠后是该行的子串。不合格的补丁 MUST NOT 提交，SHALL 记为 `semantic-patch-evidence-invalid` gap，结果带具体的不合格原因。

#### Scenario: 按名字写、没读源码
- **WHEN** 补丁没有 `evidence`，或 `quote` 不在所引的行上
- **THEN** 不提交，记一条 `semantic-patch-evidence-invalid` gap

#### Scenario: 只引声明行
- **WHEN** 一个跨多行的函数的补丁引的是 `lineRange` 第一行（函数签名）
- **THEN** 不提交，原因是 `evidence-declaration-line`

#### Scenario: 引了函数体里的一行
- **WHEN** `line` 是函数体里的一行，`quote` 是该行的一段原文
- **THEN** 补丁照常提交

### Requirement: summary 不转写自己的锚点

语义补丁的 `summary` 或 `displayName` 含节点自己的文件名紧跟行号（`<文件名>:<N>`、`<文件名> line N`、`<文件名> lines N-M`），或含节点自己带目录的 `filePath` 时，提交脚本 MUST NOT 提交，SHALL 记为 `semantic-patch-cites-anchor` gap。别的文件、主机端口或业务里的行号（如 `address line 2`）SHALL NOT 触发。

#### Scenario: 模板 summary
- **WHEN** 节点在 `src/y/f.js`，summary 是「Handles X as part of the Y service; implemented in f.js lines 10-40」
- **THEN** 不提交，记一条 `semantic-patch-cites-anchor` gap

#### Scenario: 业务里的行号
- **WHEN** summary 是「Formats address line 2」或「Sends mail through smtp.example.com:587」
- **THEN** 照常提交

### Requirement: 核验判定带读过的行

F4 的 `verified` 与 `contradicted` 判定 SHALL 带与语义补丁同样形状、同样规则的 `evidence`，`readRange` 为节点的 `lineRange`。`apply-semantic` SHALL 读源码核对，判定写入函数 MUST 收到核对函数，缺了 SHALL 报错而不是放行。

- 不合格的判定 MUST NOT 写入缓存，SHALL 计入 `verdictNoEvidence` 与 `semantic-summary-verdict-no-evidence` gap；
- 逐批提交时该 id 保持未判，下次运行再选；收尾时记为 `unverified`，计在 `verdictNoEvidence` 而不是 `verdictMissing`；
- `unverified` 判定不需要依据。

#### Scenario: 只看了名字就判 verified
- **WHEN** 一条 verified 判定没有 `evidence`，或引的是声明行
- **THEN** 该判定不写入；逐批提交后该条目仍未判，收尾后为 `unverified`

#### Scenario: 读过切片的判定
- **WHEN** 一条 contradicted 判定引了函数体里一行的原文
- **THEN** 判定照常写入，并进入矛盾归档
