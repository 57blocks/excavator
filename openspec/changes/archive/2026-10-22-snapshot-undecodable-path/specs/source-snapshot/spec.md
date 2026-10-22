## ADDED Requirements

### Requirement: 不是合法 UTF-8 的树路径可见地跳过

GitCommitSnapshot SHALL 按字节读取树里的路径。合法 UTF-8 的路径 SHALL 按 UTF-8 解码，条目与整段输出按 UTF-8 解码的结果逐字节相同。不是合法 UTF-8 的路径 SHALL 按字节做百分号编码：`%` 与 0x80 及以上的每个字节写成 `%` 加两位大写十六进制，其余字节照写。选择规则 SHALL 按这个形式判定，选择台账与处理跳过记录 SHALL 用同一个路径；被选中时它 SHALL 记为 `read-failed` 处理跳过，MUST NOT 出现在 `listFiles()` 里，其内容 MUST NOT 向 git 请求（按路径或按对象都不）。

两个不同的非 UTF-8 路径 SHALL 得到两条不同的记录。一个非 UTF-8 路径与某个合法路径同名时，快照 SHALL 显式失败，错误 SHALL 指名两者。同名指两种情形：它的百分号编码等于该合法路径，或它按 UTF-8 有损解码（`git log`、`git diff` 输出按 UTF-8 读时得到的名字）等于该合法路径。系统 MUST NOT 把一个文件的内容或历史算到另一个文件上。选择台账、处理跳过记录、文件清单与内容哈希 SHALL 与逐文件读取同一提交一致。

#### Scenario: Latin-1 路径
- **WHEN** 提交的树里有 `src/caf` 后接字节 0xE9 再接 `.ts` 的路径
- **THEN** 处理跳过里有 `{ path: 'src/caf%E9.ts', reason: 'read-failed' }`，选择台账里同一路径是选中；`listFiles()` 不含它，列出的每个路径都能 `readFile`，任何批次都不请求它的内容

#### Scenario: 彼此有损解码相同的路径
- **WHEN** 树里有末字节分别为 0xE9 与 0xFF 的两个非 UTF-8 路径，两者按有损解码是同一个字符串
- **THEN** 得到两条不同的 `read-failed` 跳过，选择台账的路径各不相同

#### Scenario: 与合法路径同名
- **WHEN** 树里有 `src/caf` 后接字节 0xE9 再接 `.ts` 的路径，以及合法路径 `src/caf` + U+FFFD + `.ts` 或 `src/caf%E9.ts`
- **THEN** 解析快照时抛出指名 `src/caf%E9.ts` 与同名合法路径的错误，不产出快照

#### Scenario: 字面的 `%` 与编码出的字节
- **WHEN** 树里有 `lib/x` 后接字节 0xE9、0xFF 再接 `.ts` 的路径，以及 `lib/x%E9` 后接字节 0xFF 再接 `.ts` 的路径
- **THEN** 两者分别记为 `lib/x%E9%FF.ts` 与 `lib/x%25E9%FF.ts`，不撞名

#### Scenario: 合法 UTF-8 路径不变
- **WHEN** 树里的路径都是合法 UTF-8，含多字节字符、开头的 BOM、U+FFFD、引号、反斜杠、制表符与换行
- **THEN** 条目与整段输出按 UTF-8 解码的结果逐字节相同
