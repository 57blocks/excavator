提交序列（每组一个 commit，合并用 `--merge`，不 squash）：
1. `docs(openspec): archive the 19 handbook changes before rewriting the skill`（已完成）
2. `docs(openspec): propose handbook-skill-first`
3. `feat(handbook): one check command for Markdown chapters and state v2`
4. `feat(handbook): prose prompts for every part of the handbook`
5. `feat(handbook): assemble the handbook from Markdown chapters`
6. `feat(handbook-page): render Markdown chapters`
7. `refactor(handbook): remove the structured parts and their checks`
8. `test(handbook): contracts and acceptance of the prose handbook`

## 1. 收尾检查与状态 v2

- [x] 1.1 先写红测试，覆盖 design O1 与 O2：
  - 越界行号；
  - 跨度 81 行；
  - 排除目录里的路径；
  - 没带引文的事实行，以及标题、冒号引导行、表头分隔行、围栏行这几类排除行；
  - 代码形状词，以及引号内原文与 mermaid 里的例外；
  - 对策以外的建议词；
  - 缺「待确认」或「问题」一节；
  - 版式：5 句的段落（引文里的点不计）、没有列表与表格的功能章节、第一行不是图类型的 mermaid；
  - 运行前后章节文件逐字节相同；
  - `--before cross` 缺章与齐全两种情形。
- [x] 1.2 实现 `check <out> [<chapter>...] [--before cross] --project <root>`，复用读者文字、禁词与路径判定；把每章的 `status`、`attempts`、`reasons` 写进 `state.json`，格式串 `excavator-product-handbook-state/2`。
  - **验证：** 1.1 全绿。
- [x] 1.3 `--fresh` 与续跑认得 `/1` 与 `/2` 两种格式串，遇到 `/1` 时提示用 `--fresh`。
  - **验证：** 两种格式串各一个测试。

## 2. 写作阶段的文字

- [x] 2.1 固定文字表新增 `chapter.openQuestions`、`chapter.problems`、`chapter.none`、`chapter.notVerified`、`chapter.notPassed`（`check` 要用，随第 1 组提交）。
  - **验证：** `check-ui` 的测试认这五个键。
- [x] 2.2 重写 `sections/features.md`：
  - 以试验提示词为骨架，并入 design D5 列出的内容要求；
  - 写明版式：节序、段落不超过 4 句、表格与列表、流程图与状态图（design D5a）；
  - 问题一节沿用类别表；
  - 派发、检查、重派一次、第二次不通过就保留的流程，只用 `check`。
  - **验证：** 文字里不出现 `entries/`、`try-entry`、`check-entry`、`findings.json`。
- [x] 2.3 重写 `sections/system.md`，由一个子代理写 `chapters/system.md`，内容按 spec「系统章节」。
  - **验证：** 同上的禁词扫描。
- [x] 2.4 新写 `sections/cross.md`，含领域、角色、通知与定时任务、横切主题、发现、对策 6 个阶段，各一份提示词，只读 `chapters/`、照抄引文组；先跑 `check --before cross`；级别标准按 design D6。
  - **验证：** 提示词里没有项目根路径变量。
- [x] 2.5 重写 `stages/outline.md`：编排者写 `outline.json`，按章节文件守恒。
  - **验证：** 目录守恒的红绿测试（并入 3.1）。
- [x] 2.6 精简 `stages/map.md`，只留地图与守恒，删去领域文件那一段；精简 `sections/data.md`、`sections/history.md` 里对旧状态的引用。
- [x] 2.7 重写 `SKILL.md`：规则、分工表、文件表、选项（`--sections` 的新名单，沿用 `--features`、`--language` 默认英文、`--fresh`）、Phase 0 到 2 与拼装阶段；只写了部分功能时跳过跨功能各章、直接拼装并说明缺几章（design D5b）。
  - **验证：** 命令名与 `handbook.mjs` 的命令表一致（合约测试在 5.2）。

## 3. 拼装与回复

- [x] 3.1 先写红测试，覆盖 design O3：
  - 产品视图没有「路径:行」；
  - 技术视图保留全部引文组；
  - 每章开头的固定文字；
  - 两次不通过的章；
  - 目录守恒不成立时用默认目录，并在覆盖一节写明；
  - 覆盖一节的各项。
- [x] 3.2 实现 `assemble` 与 `reply`：
  - 按 `outline.json` 或默认目录拼接 `chapters/*.md`；
  - 数据、状态字典与代码健康各章沿用脚本渲染；
  - 覆盖一节由脚本写出。
  - **验证：** 3.1 全绿。

## 4. 页面

- [x] 4.1 先写红页面测试，覆盖 design O4：
  - Markdown 表格；
  - 坏的 mermaid 显示原文；
  - 产品视图隐藏引文、技术视图显示文件与行；
  - 视图切换停在同一章；
  - 侧栏按目录分组；
  - 超过 32 MB 时分块；
  - 改模板后重新生成页面不派发子代理。
- [x] 4.2 `product-handbook-page` 的内容组件换成 Markdown 渲染：
  - 加 `react-markdown`、`remark-gfm`、`mermaid`，版本与 `prd-report-page` 相同；
  - 页面数据改为 design D7 的形状；
  - `page` 命令写出新数据。
  - **验证：** 4.1 全绿，`pnpm -r build` 通过，从磁盘打开页面截图。

## 5. 删除与合约

- [x] 5.1 删除 design D9 列出的命令、库模块、页面组件与只测它们的测试。每删一个模块，先用 `git grep` 确认没有别处引用，`lib/entrypoints.mjs` 与 `lib/normalize.mjs` 必须保留。
  - **验证：** 受影响的测试一条命令跑完全绿，`typecheck` 通过。
- [x] 5.2 合约测试，覆盖 design O5：
  - 每处派发都点名 `excavator-handbook-writer`；
  - 跨功能各章的提示词不出现项目路径；
  - `SKILL.md` 列出的命令与命令表一致；
  - `sections` 的新名单。
  
  同时更新 `agents/excavator-handbook-writer.md` 的描述，以及部署夹具与插件加载测试里与手册相关的部分。
  - **验证：** 合约测试全绿，`openspec validate --all --strict` 通过。
- [x] 5.3 改过的文件里零非 ASCII 字符（中文测试词用 `String.fromCharCode` 构造）；用名单扫描分支 diff，不出现客户、语料或产品名。

## 6. 验收

- [ ] 6.1 O6 与 O7 合成一次运行：在有上一版全量产物的那份私有语料上，不带 `--features` 全量运行一次（Sonnet，`--language Chinese --views product,technical`）。
  - 开跑前先报预计花费与上限；只跑这一次，运行中发现的问题只记录不修，收尾时统一列出。
  - 候选与地图沿用上一版全量产物（这两步本变更没有改），功能编号与上一版一致。
  - **验证：**
    - 每个功能都有章，跨功能 6 章都在；`check` 全部通过或有可见原因；页面能从磁盘打开；
    - 标题、叙述与固定文字是中文；
    - 精度：按大小分层抽 5 个功能、共 75 句盲审，成立不少于 64 句（上一版在该语料同一功能上的两次审读合计 85 项成立 73、错 0），错误不多于 1 句；
    - 记录花费，并和上一版全量运行对比。
  - 只跑一次，所以「`--features` 写一部分后续跑」没有在真实运行里单独验证，由 `check` 与拼装的测试覆盖，在 `acceptance.md` 里写明。
- [x] 6.2 结果写进 `acceptance.md`；没达标就照记未达标，不挪阈值。

## 7. 验收运行发现的问题

- [ ] 7.1 修 `acceptance.md` 问题清单里的 6 条，各配一个先红后绿的测试：
  - 汇总缺陷的一章改名为 `defects`（章名、节名、默认目录、保留的功能编号、提示词、测试）；
  - `reply` 最后一行是 `Run: complete` 或 `Run: incomplete (...)`，SKILL.md 写明无终端运行以这一行判断是否完成；
  - 产品视图去掉因去掉引文而整列为空的表格列；
  - 全角标点的语言里引文组用全角括号与句号，`check` 拒绝中文后的半角括号引文组；
  - 功能提示词给出打印种子文件与入口的命令；
  - 页面里表格单元格有最小宽度。
  - **验证：** 手册与页面的测试、`tsc`、构建通过；改过的行零非 ASCII 字符，名单扫描为空。
- [ ] 7.2 在 6.1 的输出目录上用同一命令续跑（不带 `--fresh`），写出缺陷与对策两章，重新拼装与生成页面。
  - **验证：** 跨功能 6 章都在，回复以 `Run: complete` 结尾，产品视图没有空的引文列；结果补进 `acceptance.md`。

