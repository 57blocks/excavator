## Why

`/excavator-prd-report` 的产物是一个目录：总览、每个功能的 PRD 章节、每个功能的 findings、核对报告与表。要读完它，得在十几个 Markdown 与 JSON 文件之间来回切，findings 与它所属的章节也不在一处。用户要的是一个页面：先看总览，再按功能看现有的功能，同一处看到这个功能的问题。

## What Changes

- **新命令 `prd.mjs page <out> --project <root>`**：把产物目录打成一个独立的 `<out>/report.html`，双击即可在浏览器打开，不需要网络、服务器或任何安装。同一输入得到字节相同的页面。它和 `excavator-view` 的页面是两个文件、两个模板，互不引用。
- **新模板包 `packages/prd-report-page`**：用 explorer 已有的做法（vite 单文件构建、内联全部资源、两个标记位注入 CSP 与数据），构建出 `prd-report-page.html` 模板。
- **页面内容**：
  - **总览**：项目名、版本、语言与读者，总览正文，计数（各状态的功能数、findings 按类别、核对合计），以及功能列表（名称、状态、findings 数、核对计数）。
  - **功能页**：章节正文（渲染 mermaid 图与 `<details>` 证据块），这个功能的 findings，这个功能的核对报告。
  - **Findings 页**：全部 findings，可按类别、功能与文字筛选；每条显示陈述、类别、所属功能与证据（`文件:行` 和引文）。
  - **覆盖页**：脚本生成的三张表、未分配的入口、没有模式的框架，以及失败的功能与原因。
- **skill 接线**：`SKILL.md` 在 `assemble` 之后运行 `page`，最后的回复多一行报告页的路径。
- `README.md`、`docs/deploy.md` 提到报告页。

**不做**：
- 页面界面文字的多语言：界面固定英文，与脚本生成的表一致；正文跟随 `--language`。
- 在页面里展示源码；只显示 `文件:行` 与引文。
- 跨功能的 findings、逐条核对徽章。
- 把报告页并进 `excavator-view`。

## Capabilities

### Modified Capabilities

- `prd-report`：新增报告页的要求；最后的回复多一行报告页路径；产物目录多一个 `report.html`。

## Impact

- 新增 `packages/prd-report-page/`，以及新依赖 `mermaid`、`rehype-raw`、`rehype-sanitize`，`pnpm-lock.yaml` 随之变化。
- `skills/excavator-prd-report/`：`prd.mjs`、新增 `lib/page.mjs`（或同类）、`SKILL.md`。
- `tests/skill/excavator-prd-report/`、`tests/skill/test_prd_report_skill_contract.test.mjs`。
- `README.md`、`docs/deploy.md`。
