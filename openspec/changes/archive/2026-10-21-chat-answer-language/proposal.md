## Why

`/excavator-chat` 规定回答语言按「当前请求显式要求 → 问题的主要自然语言 → 最近对话语言 → 英文」选，并由 `request-language.mjs` 在核实证据之后给出。2026-10-21 的真实运行里这条规则一次都没有生效：

- 同一台机器（系统首选语言中文在前）、同一份 skill 的 20 次 headless Sonnet 运行，没有一次调用 `request-language.mjs`。
- 回答语言跟着项目文件走，不跟问题走：
  - 一个语料仓库自己的 `AGENTS.md`（经 `CLAUDE.md` 引入）写着 "Reply in Chinese."。在它和它的副本上，12 次英文提问全部用中文回答，包括一次走图谱路线的结构问题，不只是按产物回答的路线；
  - 另一个语料没有这类文件，2 次英文提问都用英文回答，6 次中文提问都用中文回答。
- 所以起作用的是项目文件，不是系统区域设置；用空目录探测，headless 会话的上下文里也没有出现区域设置或回答语言的指示。写答案时没有应用语言规则，模型就照项目文件回答。

跳过的原因在 skill 的结构上：
- 第 0 步把请求状态的创建推到「第 2 步解析出 `$PLUGIN_ROOT` 之后」，而改动历史等按产物回答的路线跳过第 2–8 步；它们开头那句「按第 0 步创建请求状态」指回的正是一个依赖被跳过步骤的步骤。
- 没有任何一条路线给出可运行的命令。两次调用（`createChatRequestState` → `finalizeVerifiedAnswerLanguage`）要在 `node -e` 里写对象字面量、把问题原文放进 shell、再把状态带到下一次调用。
- 规则离写答案的地方远：语言门是第 8 步之后的单独一节；改动历史与文档问题两节的语言步骤都是第 7 步，排在第 5 步写答案之后；未用代码一节没有语言步骤；「产物缺失」这类回复在第 1 步就写给用户了。

## What Changes

- `request-language.mjs` 增加命令行入口：只收三个语言信号（各为语言或 `none`）和 `--evidence-verified`，打印 `answerLanguage` 与三个信号；缺少 `--evidence-verified` 或任一信号时以非零退出、不打印语言。不收问题原文。
- 每条回答路线在写给用户任何内容之前、核实之后，有一个同一措辞的 **Answer language** 步骤运行这条命令，并要求答案每一句（第一句、注释、关于查了什么或依据哪条规则的说明在内）都用它打印的语言，不说明选了哪种语言及原因：
  - 图谱路线：第 8 步开头；
  - 改动历史：新的第 5 步，紧接在写答案的步骤前（原第 7 步删除）；
  - 文档问题：同上，新的第 5 步，原第 7 步删除；
  - 未用代码：新的第 4 步，紧接在写答案的步骤前；
  - 以后新增的按产物回答的路线照此办理，契约测试会把缺了这一步的路线报出来；
  - 图谱或产物缺失这类直接回复，也先运行这一步。
- 三个语言信号在第 0 步、读任何产物、文档、源码或项目文件之前，从用户写的问题判断。只有用户自己的话算「显式要求」；项目文件（`CLAUDE.md`、`AGENTS.md`）、记忆、系统区域设置，以及读到的文档、产物、图谱、源码所用的语言，都不改变回答语言。
- 第 0 步的 `createChatRequestState()` 只留给图谱路线检查英文检索表达，不再是回答语言的前提。
- 语言门一节保留证据核实与优先序的定义，说明它由各路线的 **Answer language** 步骤执行。
- 不做：
  - 改变优先序本身；
  - `/excavator-doc-map` 等其它 skill 运行过程中的叙述语言；
  - 持久化任何语言选择（原有约束不变）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `canonical-semantic-language`：「回答语言由当前请求决定」改为每条 Chat 回答路线（含缺失产物的直接回复）在写答案前都按该优先序选语言，选择在运行记录中可见；项目文件、记忆、系统区域设置与所读内容的语言不算显式要求。

## Impact

- 代码：`skills/excavator-chat/request-language.mjs`（命令行入口）。
- skill：`skills/excavator-chat/SKILL.md`（第 0、1、8 步，语言门一节，改动历史、文档问题与未用代码三节，按需检索的 (d) 与诚实降级）。
- 测试：`tests/language/chat-request-language.test.mjs`；随步骤号与措辞变化更新 `tests/skill/test_hotspots_skill_contract.test.mjs`、`tests/skill/test_doc_map_skill_contract.test.mjs`、`tests/semantic-cache/semantic-cache-reuse.test.mjs` 里的断言。
- 每次回答多一次工具调用。
- `### Document questions` 一节在本变更进行中合入主线；本变更变基到它之上，按改动历史一节的同样方式补上这一步。契约测试按「有 **Product missing:** 步骤的 `###` 节」枚举路线，以后新增的同类路线缺这一步会被报出。
