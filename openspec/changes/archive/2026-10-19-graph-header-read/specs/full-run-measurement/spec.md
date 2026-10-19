## ADDED Requirements

### Requirement: 样本节点数只读图的头记录

报告读样本节点数时 SHALL 只读 `.excavator/knowledge-graph.jsonl` 的第一行（头记录）：按块读到第一个换行或文件末尾为止，MUST NOT 把整个图读成一个字符串。图的大小 MUST NOT 让运行器失败或少写报告。

- 头记录里有数字型 `counts.nodes` 时，节点数 SHALL 取这个值。
- 图不存在、读不出来、第一行解析不出，或头记录里没有数字型 `counts.nodes` 时，节点数 SHALL 记为缺失 `sample:nodes`，不当作零。

#### Scenario: 超过单串上限的图
- **WHEN** 运行结束时 `.excavator/knowledge-graph.jsonl` 约 590 MB，超过 Node 的单串上限
- **THEN** 运行器照常写出 JSON 与 Markdown 报告，样本节点数等于头记录的 `counts.nodes`

#### Scenario: 头记录解析不出
- **WHEN** 图的第一行不是 JSON
- **THEN** 样本节点数为空，`missing` 里有 `sample:nodes`
