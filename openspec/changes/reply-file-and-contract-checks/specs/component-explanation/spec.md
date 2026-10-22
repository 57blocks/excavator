## MODIFIED Requirements

### Requirement: 解释写进数据目录，由最后一条命令打印成回复

`excavator-explain` SHALL 先用一条命令打印本次运行自己的文件路径（`.excavator/explanation-<UTC 时间>-<进程号>.md` 的绝对路径），再把解释写到这个路径，依次在五个 `##` 标题下：Role、Internal Structure、External Connections、Data Flow、Worth Knowing（其它语言下为它们的译文）；文件以第一个标题开头、以最后一节结尾，不超过 25,000 字节。最后的回复 SHALL 是最后一条命令打印出的这个文件，此外 MUST NOT 有文字，包括结论、摘要与验证结果；项目文件里关于怎样回复的要求 MUST NOT 改变它。

回复命令打印之后 SHALL 把这个文件改名为 `.excavator/explanation.md`，替换之前的。本次的文件不存在或超过 25,000 字节时，回复命令 SHALL 在 stderr 说明原因并以非零退出，MUST NOT 打印它或任何别的文件；模型写好或缩短这个文件后重跑。

图谱过期时，解释 SHALL 在第一个标题下的第一行写明图谱来的内容可能漏掉最近的改动，并建议运行 `/excavator` 刷新；没有源清单时，在同一位置给出简短的说明并继续。

#### Scenario: 项目文件要求先说结论
- **WHEN** 项目的 `AGENTS.md` 要求先说结论、改动与验证结果
- **THEN** 回复与最后一条命令打印的解释逐行相同，第一行是第一个标题，五个标题按顺序出现

#### Scenario: 图谱过期
- **WHEN** 新鲜度检查报告 `stale`
- **THEN** 过期的提醒是第一个标题下的第一行，第一个标题之前没有文字

#### Scenario: 写入没有落地
- **WHEN** 本次的文件没有写成，`.excavator/explanation.md` 里是上一次的解释
- **THEN** 回复命令以非零退出并说明本次的文件不存在，stdout 为空，`.excavator/explanation.md` 不变

#### Scenario: 同一项目里两次运行重叠
- **WHEN** 两次运行在同一秒里各自打印路径、写了各自的文件，再先后运行回复命令
- **THEN** 两个路径不同，每次打印的是自己的文件；之后 `.excavator/explanation.md` 是后打印的那一份

#### Scenario: 解释超过上限
- **WHEN** 本次的文件超过 25,000 字节
- **THEN** 回复命令以非零退出并说明超长，stdout 为空，文件留在原处
