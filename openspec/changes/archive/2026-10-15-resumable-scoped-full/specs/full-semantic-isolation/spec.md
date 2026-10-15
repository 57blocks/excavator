## MODIFIED Requirements

### Requirement: Summary-Verifier 留在 Full

Summary-Verifier SHALL 在 Full 流程中核验语义产物（semantic-cache/semantic-graph），MUST NOT 进入 Lazy 关键路径。

- F4 SHALL 只选还没有判定的 summary：条目没有 `verification`，或为 `dirty`。已判 `verified`、`unverified`、`contradicted` 的条目不再选；summary 重新生成时条目整条替换、不带判定，所以会被再选。
- 判定 SHALL 逐批提交：一批的判定只写给该批核验文件列出的 id。
- 收尾时 SHALL 只认本次选中的 id、只读本次批号的判定文件；其余判定计入可见的计数，不写入缓存。

#### Scenario: Full 核验语义、Lazy 不核验
- **WHEN** 运行 Full
- **THEN** Summary-Verifier 核验生成的语义并写回核验状态；Lazy 首跑不触发它

#### Scenario: 已有判定的 summary 不重核
- **WHEN** 第二次运行 Full，缓存里一部分 summary 已有判定，另一部分是本次新生成的
- **THEN** F4 只选新生成的那部分与仍是 `dirty` 的条目

#### Scenario: 批外的判定不写入
- **WHEN** 第 i 批的判定文件里出现一个不在第 i 批核验文件里的 id
- **THEN** 该判定不写入缓存，计入不在本批的计数
