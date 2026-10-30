## Why

onboard-report-language、explain-reply-language、diff-reply-language 三个变更的第一轮审查留下四个 Nit，合在这里一起处理。

1. **回复可能是旧文件。** explain 第 8 步把解释写到 `.excavator/explanation.md`，第 9 步的回复是 `cat` 这个文件打印的内容；diff 第 7、8 步对 `.excavator/diff-analysis.md` 做法相同。下面两种情况里，`cat` 打印的是上一次的分析，讲的是别的东西；固定标题里没有组件名，读的人看不出来：
   - 写入没有落地。比如文件已经存在、本会话没读过，宿主的写入工具拒绝覆盖；或者写入权限被拒。
   - 同一项目里两次运行重叠。
2. **长输出被截断。** 宿主会截断长的命令输出，而回复只能是命令打印的那些行。在 Claude Code 里实测：
   - 25,000 字节的输出原样到达；
   - 30,591 字节的输出，模型只看到前 2 KB，其余存进一个文件（`BASH_MAX_OUTPUT_LENGTH` 默认 30,000 字符）。

   所以长的解释或分析到达用户时会缺几节。
3. **diff 的参数提示缺 PR 编号。** `argument-hint` 只有 `[--language <lang>]`，没有第 2 步接受的 PR 编号。
4. **坏副本只断言「报了问题」。** 契约测试里的坏副本只断言检查器报了某个问题，没断言是哪一个。改前实测，8 个语言规则契约测试共 53 个检查，删掉其中 30 个后所有测试仍然全绿：

   | 测试 | 检查数 | 删掉后仍全绿 |
   |---|---|---|
   | onboard | 6 | 4 |
   | explain | 6 | 4 |
   | diff | 6 | 4 |
   | hotspots | 7 | 3 |
   | unused-code | 7 | 3 |
   | prd | 7 | 4 |
   | verify | 7 | 5 |
   | doc-map | 7 | 3 |

   doc-map 不在审查点名的名单里，但写法相同，一并处理。

## What Changes

- **本次运行自己的文件。** explain 第 8 步、diff 第 7 步先用一条命令打印本次运行自己的文件路径，再把解释（分析）写到这个路径，文件不超过 25,000 字节。路径形如 `.excavator/explanation-<UTC 时间>-<进程号>.md` 或 `.excavator/diff-analysis-<UTC 时间>-<进程号>.md`。
- **回复命令。** explain 第 9 步、diff 第 8 步的回复命令改为：
  - 本次的文件不存在，或超过 25,000 字节：在 stderr 说明原因，以非零退出，什么都不打印；
  - 否则：打印它，再把它改名为 `.excavator/explanation.md`（或 `.excavator/diff-analysis.md`），替换之前的。

  命令失败时，写好或缩短这个文件再重跑；不得改为打印别的文件。
- **参数提示。** diff 的 `argument-hint` 改为 `[pr-number] [--language <lang>]`。
- **坏副本。** 8 个契约测试的每个坏副本都断言它针对的那个问题。doc-map 原来没有坏副本能触发「Step 7 的 Language 段在建议检查之前」，补一个。
- **回复命令的测试。** explain 与 diff 的契约测试在临时项目里实际运行这两条命令，覆盖四种情况：打印本次的文件；本次的文件缺失时不打印旧文件；同一秒里的两次运行各打印自己的文件；超长时不打印。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `component-explanation`：解释写进本次运行自己的文件，有长度上限；回复命令只打印这个文件。
- `diff-analysis`：分析的做法同上。

## Impact

- **改动的文件：** `skills/excavator-explain/SKILL.md`、`skills/excavator-diff/SKILL.md`、8 个 `tests/skill/test_*_skill_contract.test.mjs`，以及两个主规格。
- **回复的形式不变：** 仍是命令打印的整份文件，五个固定标题。按要求只在回复形式改变时才做真实运行，所以这次不跑。
- **skill 的其它措辞不变。**
- **`.excavator/` 里的文件：** `.excavator/explanation.md` 与 `.excavator/diff-analysis.md` 仍是最后一次的解释与分析。运行如果在回复之前中断，本次的文件会留在 `.excavator/` 里。
