## ADDED Requirements

### Requirement: 检查器以记录来源的副本存在

`skills/skopo-create/checker/` SHALL 只包含从 Skopo 仓库复制来的检查器文件与一个 `SOURCE.json`。`SOURCE.json` SHALL 记录来源仓库、来源 commit，以及每个文件的 SHA-256：`keywords.json` 按解析后再序列化的文本计算，其余文件按字节计算。目录里的文件与 `SOURCE.json` 列出的文件 SHALL 一一对应。测试 SHALL 重算每个文件的哈希；任何一个文件被改动、缺失或多出时，测试 MUST 失败。

#### Scenario: 副本被本地改动
- **WHEN** `checker/lint.mjs` 被改了一个字节
- **THEN** 测试失败，并指出该文件的哈希与 `SOURCE.json` 不符

#### Scenario: 多出一个文件
- **WHEN** `checker/` 里出现一个 `SOURCE.json` 没有列出的文件
- **THEN** 测试失败，并指出这个文件

### Requirement: 关键字词典只含 ASCII

`checker/keywords.json` 的副本 SHALL 把每个非 ASCII 字符写成 JSON 的 `\u` 转义，解析结果 SHALL 与来源文件相同。

#### Scenario: 中文关键字
- **WHEN** 来源 `keywords.json` 含有中文关键字
- **THEN** 副本只含 ASCII 字符，解析后与来源相同，仓库的中文门禁通过

### Requirement: 副本带着自己的许可

`checker/` SHALL 包含 Skopo 检查器的许可证文本（Apache-2.0），`NOTICE` SHALL 说明该目录的来源与许可。

#### Scenario: 许可可见
- **WHEN** 查看 `NOTICE`
- **THEN** 它指出 `skills/skopo-create/checker/` 来自 Skopo、采用 Apache-2.0，许可证文本在该目录
