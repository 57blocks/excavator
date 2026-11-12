## Why

手册与页面现在没有系统的名字。页面的标题栏与每页的眉题写的是项目根目录的名字，那只是存放代码的文件夹，常常是仓库名、缩写或临时目录名，不是产品的名字。验收语料上，页面写的就是临时目录名，而代码里的清单文件写着产品的全名。

名字是读者认出这本手册在讲什么的第一样东西，必须来自代码，带出处，并像概览的其它项一样经过核对。

## What Changes

- **名字候选由脚本列出。** `handbook.mjs applications` 之外新增 `handbook.mjs names`，确定性地列出代码与配置里写着的系统名字，每个都带文件与行号。认得的形式（design D1）：
  - 网页应用清单的 `name`、`short_name`；
  - HTML 的 `<title>`。引用环境变量的（如 `%VITE_TITLE%`）从同一应用的 `.env*` 文件取值，取不到就照原样列出并标明；
  - `package.json` 的 `productName`、`displayName`、`name`；
  - `go.mod` 的模块路径的最后一段；
  - Maven 的 `<name>`、`<artifactId>`，Gradle 的 `rootProject.name`。
- **概览子代理选一个。** 概览加 `name` 项：从候选里选读者认得的产品名，原样照抄，引用候选所在的那一行。代码里没有合适的名字时写 `null`，并在 `unknowns` 里写明。
  - `check-overview` 核对名字与某个候选的值逐字相同、引文就是那个候选的出处；
  - 然后与概览的其它项一样经过两名核对者与两名追查者。
- **手册与页面用这个名字。**
  - 手册的标题带名字；
  - 页面的标题栏、浏览器标题与各页眉题用名字，不再用目录名；
  - 名字没核实或没有时，写一句固定文字，说明代码里没有找到系统名字，不退回到目录名。
- **旧的输出目录**：已经核实的概览没有 `name`，手册按「没有找到」显示，概览不重写。要名字就以 `--fresh` 重跑，或删掉概览后续跑。

**不做**：
- 从 README 或其它说明文档取名字：概览的引文本来就不许指向说明文档；
- 多个名字的别名表。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `product-handbook`：新增「系统的名字」。

## Impact

- `skills/excavator-product-handbook/`：
  - 新模块：名字候选；
  - `handbook.mjs names`；
  - 概览的形状、项、检查：`name`；
  - `sections/overview.md`：打印候选、提示里的 `name` 规则；
  - 渲染：手册标题；
  - `ui-strings.json` 新键。
- `packages/product-handbook-page/`：页面数据的 `project` 改为系统名字或空，格式升一版；标题栏、浏览器标题与眉题。
- 测试：新夹具与候选测试、概览检查测试、渲染与页面测试、合约测试的摘要更新。
