## Why

`/excavator-doc-map` 第一步已经能列出一个文件夹的功能文档写了哪些功能，每条带核对过的原文。第二步要回答：每条功能在代码里的哪里。没有这一步，第三步的覆盖报告（有文档有代码、有文档没代码、有代码没文档）没有输入。

哪段代码在做哪个功能是判断题，交给模型。但模型给出的位置要能核对：
- 文件真在项目里，不是项目外的文件，也不是文档本身；
- 引的那段代码真在那个文件里，行号由脚本算，不由模型写；
- 没找到代码的功能要写明搜过什么，而不是悄悄缺席。

## What Changes

- `doc-map.py` 新增子命令 `link <对应清单文件> <项目目录>`：
  - 读模型写的对应清单 `{ "links": [ { "unit", "status", "evidence": [ { "file", "code" } ], "searched" } ] }`，`unit` 是产物里功能的序号（从 1 起）；
  - `status` 只能是 `found`（附至少一处证据）或 `not-found`（没有证据，`searched` 列出搜过的内容）；
  - 每处证据逐条核对：
    - 文件在项目目录里、是普通文件；
    - 不在 `.git`、`.excavator`、文档目录里；
    - 不是文档格式（`.md`、`.txt`、`.pdf`、`.docx` 等）；
    - 内容与任何一份已读文档都不相同；
    - 引的代码在文件里恰好出现一次（比对前做与引文相同的统一处理）。
  - 行号由脚本算出。全部通过才写入；有一条不通过就报出全部问题，产物不变；
  - 清单里没有的功能记为 `not-checked`。三种状态的计数之和等于功能数。
  - 同时记下代码的基线：项目是 Git 仓库时记 `HEAD`，否则为 `null`。
- 产物 `doc-map.json` 增加字段：
  - `code`（项目根与基线）；
  - `counts.found`、`counts.notFound`、`counts.notChecked`；
  - 每条功能的 `code`（状态、证据、搜过的内容）。
  - 重新 `read` 或 `units` 会把这些字段清回 `null`。格式名不变，字段只增不减。
- skill `/excavator-doc-map` 在列出功能之后多一步「对到代码」：
  - 按功能分批，每批派一个子代理；
  - 子代理拿到功能的编号、标题和它在文档文本里的行范围，在项目源码里搜索、读代码，写出对应清单；
  - 合并后运行 `link`，报错就按报错改。
  - 报告增加：各状态的计数、每份文档的 found / not-found 数、每条功能的证据位置，以及没找到代码的功能各自搜过什么。报告不说「已实现」「未实现」，只说找到或没找到代码。
- 不做：
  - 覆盖报告与「有代码没文档」（第 3 步）；
  - `excavator-chat` 读这份产物（第 3 步）；
  - 用知识图或 MCP 工具找代码，或要求先跑 `/excavator`；
  - 第二个模型复核每条对应（见 design.md 第 7 条，按验收结果再定）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `doc-map`：从「列出文档写了的功能」扩展到「把每条功能对到代码，证据由脚本核对」。产物与 skill 的要求随之修改。

## Impact

- 修改：`skills/excavator/doc-map.py`（新子命令、产物字段）、`skills/excavator-doc-map/SKILL.md`（新步骤与报告）、`README.md`（这条命令的说明）。
- 测试：`tests/skill/test_doc_map.test.mjs` 增加 `link` 的单测，`tests/skill/test_doc_map_skill_contract.test.mjs` 增加分批与报告查询的契约测试。
- 不改其它 skill、脚本和产物。
