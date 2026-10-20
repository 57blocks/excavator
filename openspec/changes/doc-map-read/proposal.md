## Why

团队常在仓库外留着功能文档：用例、需求规格、PRD、用户手册，格式是 `.docx`、`.pdf`、`.html`、`.md` 等。想知道「文档写了的功能实现了没有」「哪些代码没有文档」，第一步要把这些文档读进来，列出里面写了哪些功能。现有的 `/excavator-knowledge` 只读 Karpathy 式的 wiki（`index.md` 加 wikilink），不读 Word、PDF、HTML。

这件事分三步做，这是第一步：
1. 读文档、列出文档写了的功能（本变更）；
2. 把每个功能对到代码，带证据；
3. 覆盖报告：有文档有代码、有文档没代码、有代码没文档。

列出功能是判断题：哪一段算一个用例、一条需求，按文档自己的结构决定，由模型做。但两件事要由脚本做：
- **把文件变成文本。** 每个文件都要落进一个看得见的桶（读到了、没有转换工具、格式不支持、转换失败、没有文字），不能有文件被悄悄跳过；
- **核对模型的引文。** 模型给每个功能附一段原文，脚本核对这段原文确实在这份文档的文本里。否则模型写出的功能名没有可核对的出处。

## What Changes

- 新增 skill `/excavator-doc-map <文档目录> [项目目录]`，第一步只读文档、列功能，不碰代码。
- 新增脚本 `skills/excavator/doc-map.py`，只用 Python 标准库，两个子命令：
  - `read <文档目录> <项目目录>`：
    - 递归列出文档目录下的每个文件（不进 `.git`，不跟随符号链接），按扩展名转成纯文本；
    - 纯文本类（`.md`、`.markdown`、`.txt`、`.rst`、`.adoc`）原样读；`.html`、`.htm`、`.xhtml` 去标签；`.docx`、`.odt` 从压缩包里的 XML 取段落；`.pdf` 调 `pdftotext`；`.doc` 调 `textutil` 或 `antiword`；
    - 文本写到 `<项目>/.excavator/doc-map/text/<原路径>.txt`；
    - 产物 `<项目>/.excavator/doc-map.json`（`excavator-doc-map/1`）记每个文件的状态：`read`、`empty`、`no-converter`、`unsupported`、`failed`，并附原因。头部给各状态的计数，各状态之和等于文件总数。
  - `units <功能清单文件> <项目目录>`：
    - 读模型写的功能清单 `{ "units": [ { "document", "id", "title", "quote" } ] }`；
    - 逐条核对：文档是 `read` 状态；`quote` 在这份文档的文本里（比对前统一空白、全半角和弯引号）；`id` 不为空时也在文本里；同一文档里 `id` 和 `quote` 都不重复；
    - 全部通过才写进产物，并给每条算出位置：文本里的行号，PDF 再加页码；同一段原文出现几次也记下。有任何一条不通过就报出全部问题，产物不变。
- skill 的流程：
  1. 运行 `read`，汇报各状态的计数；没有转换工具的格式要说缺哪个工具；
  2. 按文本大小把读到的文档分批，每批派一个子代理读文本、按文档自己的结构列功能（编号的用例或需求一条一个；没编号时一个描述功能的小节一个），每条附一段原文；
  3. 合并成功能清单，运行 `units`；报错就按报错改，再运行；
  4. 用固定查询汇报：各状态的文件数、没读到的文件及原因、每份文档列出的功能数、功能清单。只陈述，不评价文档，不给建议。
- 不做：
  - 把功能对到代码、覆盖报告（第 2、3 步）；
  - `excavator-chat` 读这份产物（第 3 步）；
  - `.pptx`、`.xlsx`、`.rtf`、图片和扫描件的文字识别。这些文件落在 `unsupported` 或 `empty`，看得见；
  - 往运行镜像里装 `pdftotext`。镜像里读 PDF 会落在 `no-converter`。

## Capabilities

### New Capabilities

- `doc-map`：读一个文件夹的功能文档、列出文档写了的功能，每条功能带可核对的原文出处。

### Modified Capabilities

（无）

## Impact

- 新增：`skills/excavator-doc-map/SKILL.md`、`skills/excavator/doc-map.py`。
- 测试：新增 `tests/skill/test_doc_map.test.mjs`（脚本）、`tests/skill/test_doc_map_skill_contract.test.mjs`（skill 的查询与固定写法）。安装测试里 skill 的数目从 12 变成 13。
- 不改现有脚本、skill 和产物。
