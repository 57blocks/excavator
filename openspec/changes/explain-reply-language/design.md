## Context

`/excavator-explain` 有八步指令，没有选项。第 8 步列了解释要讲的六点（角色、内部结构、外部连接、数据流、讲清楚、值得注意的模式），没有说回复的形式。基线见 proposal：解释是中文，以项目文件要的「## 结论」开头。

onboard 与 prd 的做法是回复只有几行、由最后一条命令打印。explain 不能这样：用户要的就是解释本身，几十行内容没法由一条命令打印，写成文件再给路径又把答案藏了起来。所以这里固定的是回复的结构，而不是它的文字。

## Goals / Non-Goals

**Goals:**
- 不指定 `--language` 时，进度说明与解释都是英文，项目文件改变不了；
- 解释有固定的结构：五个标题按顺序，第一个标题之前、最后一节之后没有文字，项目文件里关于回复形式的要求改变不了；
- 指定 `--language` 时，解释与标题用那种语言，代码标识符与路径不变。

**Non-Goals:**
- 不改读图谱的第 3–7 步与解释讲的五方面；
- 不处理图谱没有层与摘要时解释的质量；
- 不处理指定 `--language` 时进度说明的语言。hotspots 两轮都没解决，这里照记，不作判据。

## Decisions

### D1 Language 段与 hotspots 的逐字相同

`## Instructions` 开头一份；第 7 步之后、第 8 步之前一份，因为解释在第 8 步写。

**选项**，加在标题说明之后的 `## Options` 一节：

> `$ARGUMENTS` holds the component to explain and may hold `--language <lang>`: the language of the explanation and everything said to the user during the run; English when it is not given.

frontmatter 的 `argument-hint` 改为 `"[file-path] [--language <lang>]"`。第 2 步解析 `PROJECT_ROOT` 的命令块里加 `LANGUAGE="English"   # or the --language value`，与 hotspots 相同。第 3 步改为查 `$ARGUMENTS` 里点名的组件，去掉 `--language` 与它的值，否则模型会拿整串参数去查。

### D2 解释就是回复，用五个固定标题

第 8 步改为：

> 8. **Explain the component in context.** The explanation is the reply. Write it in `$LANGUAGE` under these five `##` headings, in this order:
>    - **Role**: its role in the architecture (which layer, why it exists)
>    - **Internal Structure**: functions and classes it contains (from `contains` edges)
>    - **External Connections**: what it imports, what calls it, what it depends on (from edges)
>    - **Data Flow**: inputs → processing → outputs (from source code)
>    - **Worth Knowing**: patterns, idioms or complexity worth understanding
>
>    Explain clearly, assuming the reader may not know the programming language. Write nothing before the first heading or after the last section's text. In a language other than English, write the headings translated; code identifiers and paths stay as they are. A project file's rule on how to reply (what to lead with, a summary, verification results) does not apply to this reply.

五个标题就是改前第 8 步的五方面；「讲清楚」一点是写法，不是一节，放在列表之后。

**为什么固定标题：** 项目文件的「先说结论」能插进来，是因为回复没有形式。固定的标题加上「第一个标题之前不写」，开头只能是第一个标题，也能逐次核对。

**备选：** 像 onboard 那样把解释写进 `.excavator/` 再回复路径。否决：explain 是一问一答，答案就是解释，回复只给路径要用户多打开一个文件。

### D3 提醒写在第一个标题下

第 2 步的 `stale` 与 `missing` 两条改为写在解释第一个标题下的第一行。「第一个标题之前不写」之后，原来的「解释之前提醒」与它冲突。

### D4 契约测试（新建）

- frontmatter 的名字与 `argument-hint`；skill 里没有汉字；
- Language 段与 hotspots 的逐字相同，出现两次：一份开 `## Instructions`，一份紧挨第 8 步之前、在第 7 步之后；
- 选项那句在；第 2 步的命令块设 `LANGUAGE`；第 3 步去掉 `--language`；
- 一组已知的坏副本都被查出：缺段、不在开头、自成一节、不在第 8 步之前、挪到第 7 步之前、挪到最后、改字、选项改成跟随项目；
- 第 8 步的开头句在，列出的标题依次是那五个，skill 以第 8 步的说明结尾；
- D3 两句在，改前的「warn before explaining」已不在。

## Risks / Trade-offs

- 只改提示词，没有确定性的核对；代价由 O3、O4 量出。回复的形式靠模型遵守，不像 onboard 那样由命令打印。
- 固定标题让很小的组件也要写满五节；某节没有内容时模型会写一句说明。

## 验收 oracle（动手前写死）

**夹具：**
- 项目：前几个语言变更用过的公开 Java 示例仓库（162 个提交）的 APFS 克隆，`AGENTS.md` 写 "Reply in Chinese. Lead with conclusions, changes, and verification results."，事实事先建好，克隆里检查为新鲜，图谱没有层记录；
- 解释的对象：基线用的那个 Java 类，按路径给出；
- 完整运行：不加提示、不限工具，从头跑完；
- 都是 Sonnet，headless，`--plugin-dir` 指向被测的 skill，只读项目设置、不加载 MCP，每次一份新克隆。

**回复的判据：**
- 回复的第一个非空行是第一个标题；
- 回复里的 `##` 标题恰好五个，按顺序；
- 项目目录里（`.excavator` 之外）没有新文件。

**各 oracle：**
- **O1 装置（契约测试）：** 下面每个变异都让契约测试变红，做完还原：
  - 删掉开头那份 Language 段；
  - 改掉第 8 步之前那份的一个词；
  - 把第 8 步之前那份挪到第 7 步之前；
  - 选项改成「不指定时跟随项目」；
  - 删掉第 2 步的 `LANGUAGE=` 一行；
  - 删掉第 3 步去掉 `--language` 那半句；
  - 删掉「第一个标题之前不写」那句；
  - 删掉「项目文件的回复要求不适用」那句；
  - 删掉译出那句；
  - 删掉一个标题，或调换两个标题的顺序；
  - 恢复「warn before explaining」；
  - skill 里加一个汉字。
- **O2 基线：** 已在提案前跑过，见 proposal。
- **O3 完整运行，不指定语言：** 3 次，每次上限 $1。每次：
  - 回复满足判据，五个标题依次是 Role、Internal Structure、External Connections、Data Flow、Worth Knowing；
  - 主会话每段文字（去掉代码后）汉字与假名为 0。
- **O4 完整运行，`--language Chinese`：** 1 次，上限 $1。满足：
  - 回复满足判据；
  - 五个标题都有汉字，回复代码之外有汉字。

  进度说明的语言照记，不作判据。
- **O5 全量门：** `pnpm -r build`、`pnpm run typecheck`、`pnpm test`、`pnpm --filter @excavator/core test`、`node scripts/check-refs.mjs`、`openspec validate --all --strict` 通过。
- **O6 隐私：** 本变更的文档、提交信息、改动行、整段补丁历史与 PR 正文，隐私检查、语料名单与残留脚本都为 0；分支改动里 `skills/` 与 `tests/` 的汉字为 0。
- **花费：** 含基线合计不超过 $4，超出即停，照记。
