## Context

- 页面数据的 `project` 现在是 `basename(项目根)`（`lib/page-data.mjs`）。它同时用来把产物里的绝对路径换成短名字，这个用途不变。
- 手册标题是固定文字 `md.title` / `md.titleTechnical`，不带名字。
- 概览由子代理写，`check-overview` 检查，第 5、6 阶段核对与追查。概览的引文不许指向说明文档。

## Goals / Non-Goals

**Goals**：
- 名字候选由脚本确定性列出；
- 模型只做选择，并且选出的值逐字等于某个候选；
- 名字经过核对与追查；
- 手册与页面用它，不退回到目录名。

**Non-Goals**：
- 说明文档里的名字；
- 别名；
- 改动路径的替换。

## Decisions

### D1 候选

新模块列出候选，每个是 `{ value, source, file, line, resolved }`。`source` 是下列之一：

| `source` | 取什么 |
|---|---|
| `web-manifest-name` | `manifest.json`、`*.webmanifest` 的 `name` |
| `web-manifest-short-name` | 同上的 `short_name` |
| `html-title` | `index.html` 等 HTML 入口的 `<title>` 文字 |
| `package-product-name` | `package.json` 的 `productName` |
| `package-display-name` | `package.json` 的 `displayName` |
| `package-name` | `package.json` 的 `name` |
| `go-module` | `go.mod` 的 `module` 路径的最后一段 |
| `maven-name` | `pom.xml` 顶层的 `<name>` |
| `maven-artifact` | `pom.xml` 顶层的 `<artifactId>` |
| `gradle-root` | `settings.gradle(.kts)` 的 `rootProject.name` |

- **只在应用根目录与其 `public/` 下找**，即 `handbook.mjs applications` 列出的根。不遍历整个项目，不读说明文档。
- **HTML 标题引用环境变量**：`%NAME%`、`${NAME}`、`import.meta.env.NAME` 形式。
  - 从同一应用根下的 `.env`、`.env.production`、`.env.development` 按这个顺序找 `NAME=value`，找到的作为一个独立候选。`file` 与 `line` 是 `.env` 文件里那一行，`resolved: true`；
  - 原来的 `<title>` 行照样是一个候选，值原样保留，`resolved: false`。
- **空值不是候选**，例如 `<title></title>`、`"name": ""`。
- 相同值、相同位置的只留一个。按应用根、文件、行排序。
- `handbook.mjs names "$PROJECT_ROOT"` 每行打印一个候选：值、来源、`文件:行`。

### D2 概览的 `name`

- 形状加必有的键 `name`：`{ "text": "<候选的值，原样>", "evidence": E }` 或 `null`。
- 核对后的概览可以没有这个键：名字被删时整个键不在，与功能条目删去用途相同。
- **`check-overview` 的检查**：
  - `text` 与某个候选的值逐字相同；
  - `evidence` 只有一条，文件与那个候选相同，引文包含那一行的值；
  - `null` 时 `unknowns` 里必须有一项（不检查它的措辞）。

  违反时打印一行，指出 `name`。
- **项与主张**：`name` 是一项，主张写 `System name > <text>`。`text` 照抄源码，不做语言检查，不做禁词检查：名字可以是混合大小写的词。
- **提示**（`sections/overview.md`）：
  - 第 2 步多打印 `names` 的输出；
  - 规则写明：
    - 从候选里选读者认得的那个产品名：优先完整的产品名，而不是包名、模块名或缩写；
    - 原样照抄；
    - 引用候选所在的文件与那一行；
    - 候选里没有像产品名的，写 `null` 并在 `unknowns` 里写明看过哪些候选。

### D3 呈现

- **页面数据**：
  - `project` 改为已核实的名字，没有时为 `null`，格式升一版；
  - 路径替换用的目录名另存为内部字段或不进页面数据，由实现决定，但不显示。
- **页面**：
  - 标题栏、浏览器标题与各页眉题用名字；
  - 为 `null` 时用固定文字 `page.systemNameMissing`，`page.documentTitle` 不带名字的那一版另用一个键。
- **手册**：
  - 标题有名字时用新键 `md.titleNamed`（`{name} - Product handbook`）与 `md.titleTechnicalNamed`；
  - 没有名字时用原来的标题，并在概览一节开头加一句固定文字：代码里没有找到系统名字。
- **覆盖一节**：名字被删时，与概览的其它被删项一样列出。

### D4 旧的输出目录

- 已经核实的概览没有 `name` 键，`check-overview` 照样接受（视为核对后被删的情形，不是新写的概览）。
- 呈现按「没有名字」处理。
- 新写的概览必须有这个键。

## Risks / Trade-offs

- **模型可能选包名或缩写**，而不是全名。提示写明偏好，验收看它在真实语料上选了什么。核对者只判断「这是代码里写的名字」，判断不了「这是最好的名字」。
- **候选里只有缩写时**，手册就用缩写，因为那是代码里有的。

## Oracles

- **O1 候选**：夹具覆盖每种 `source`、环境变量标题解析成功与失败各一、空值、`public/manifest.json`、一个不在应用根下的 `package.json`（不列出）。期望手写。
- **O2 概览检查**：
  - 值不在候选里；
  - 引文不是候选的那一行；
  - `null` 而 `unknowns` 为空；
  - 旧的已核实概览没有 `name`。

  各一条测试。变异，各至少一条测试变红：
  - 去掉「逐字等于候选」；
  - 页面没有名字时退回目录名。
- **O3 呈现**：
  - 手册标题有名字；
  - 没有名字时的固定文字；
  - 页面标题栏、浏览器标题与眉题；
  - 页面数据里没有目录名。
- **O4 真实运行**（go-multirepo，Sonnet 是测量条件）：在第 3c 片输出的副本上，去掉 `state.json` 的 `overview` 键与概览文件，以 `--sections overview --views technical` 续跑。
  - 记录花费、候选列表、选中的名字，以及它是否通过核对与追查；
  - 页面不再出现目录名；
  - 地图、条目与数据逐字节不变。
- **O5**：受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑；源码零非 ASCII 字符；名字扫描无命中。
