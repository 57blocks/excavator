## ADDED Requirements

### Requirement: 系统的名字

`handbook.mjs names` SHALL 确定性地列出应用根目录下代码与配置里写着的系统名字候选，每个带值、来源、文件与行。它认得以下形式，不读说明文档：
- 网页应用清单的名字；
- HTML 标题，包括从 `.env*` 文件解析出的环境变量；
- 包清单与构建文件里的名字。

概览 SHALL 有 `name` 项：一个候选的值，原样照抄，引用该候选所在的那一行；代码里没有合适的名字时为 `null`，并在 `unknowns` 里写明。`check-overview` SHALL 拒绝不等于任何候选的值，以及不指向该候选那一行的引文。名字 SHALL 与概览的其它项一样经过核对与追查。

手册与页面 SHALL 用已核实的名字作标题；页面的标题栏、浏览器标题与眉题 SHALL NOT 显示项目根目录的名字。没有已核实的名字时，SHALL 写一句固定文字说明代码里没有找到系统名字。

#### Scenario: 从清单文件取名
- **WHEN** 前端的 `public/manifest.json` 写着 `"name": "Acme Portal"`，`package.json` 的 `name` 是 `acme-ui`
- **THEN** `names` 列出两个候选；概览选 `Acme Portal` 并引用清单文件那一行，核实后手册标题与页面标题栏都写 `Acme Portal`

#### Scenario: 标题引用环境变量
- **WHEN** `index.html` 的标题是 `%VITE_TITLE%`，同一应用的 `.env` 有 `VITE_TITLE=Acme Portal`
- **THEN** `names` 列出 `.env` 那一行的 `Acme Portal`（已解析），也列出原样的 `%VITE_TITLE%`（未解析）

#### Scenario: 名字不在候选里
- **WHEN** 概览的 `name` 写 `Acme 门户`，候选里没有这个值
- **THEN** `check-overview` 退出 1，并打印 `name` 的位置与原因

#### Scenario: 没有名字
- **WHEN** 概览的 `name` 是 `null`，或核对删去了名字
- **THEN** 手册用不带名字的标题，概览开头说明代码里没有找到系统名字；页面不显示目录名

#### Scenario: 旧的输出目录
- **WHEN** 续跑一个概览已核实、但没有 `name` 的输出目录
- **THEN** 概览不重写，手册按没有名字显示
