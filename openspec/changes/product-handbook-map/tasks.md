## 1. 提案（提交 1）

- [x] 1.1 proposal、design（含验收 oracle O1–O8）、specs、tasks；`openspec validate --strict`

## 2. 入口列表迁移（提交 2）

只搬家，不改行为：旧 skill 的输出与测试断言都不变（O4）。

- [x] 2.1 `entrypoints.mjs`、`entrypoint-catalog.json`、`normalize.mjs` 移到 `skills/excavator-product-handbook/lib/`；列表函数不再自带 `format`，旧 skill 的 `entrypoints` 命令盖回原格式串（D3）
- [x] 2.2 旧 skill 的引用路径、`tests/skill/excavator-prd-report/entrypoints.test.mjs` 与 normalize 测试的引用路径跟着改
- [x] 2.3 O4：迁移前后旧 skill 在同一夹具上的 `entrypoints.json` 逐字节比较
- [x] 2.4 最小 `SKILL.md`（只有 frontmatter 与一句说明，写明尚未可用），随之更新安装测试与加载夹具里的 skill 计数：`check-refs` 要求每个 skill 目录都有 `SKILL.md`，没有它这个提交过不了门；5.1 再写完整内容

## 3. 脚本（提交 3）

- [x] 3.1 `handbook.mjs`：`candidates`、`check-map`、`check-entry`、`mark`、`check-ui`、`assemble`，退出码与 `Next:` 行（D2）；随 skill 发布的英文固定文字表 `ui-strings.json`（D12）
- [x] 3.2 地图检查：格式、守恒、到达方式与标签、角色、种子文件（D4）
- [x] 3.3 条目检查：结构（D5）、引文与路径（D6）、禁词门（D7）、值核对（D8）；状态记录与两次尝试（D9）
- [x] 3.4 `assemble`（D11）
- [x] 3.5 测试：O2、O3、O5（含 `check-ui`）。每类拒绝先写坏夹具看到红，再写合法夹具看到绿；身份夹具（同内容不同路径、同名不同区域）

## 4. 页面（提交 4）

模板与 `page` 命令一起提交：`page` 读模板，拆开的中间版本过不了测试。

- [x] 4.1 `packages/product-handbook-page`：单文件模板（沿用现有报告页的构建方式与两个标记），区域导航、功能页、覆盖页，浅色与深色，手机宽度；固定文字全部取自数据里的 `ui`（D13）
- [x] 4.2 `handbook.mjs page`：组装页面数据、填模板、经临时文件与重命名写出；失败时不留旧页面
- [x] 4.3 根目录构建与类型检查加上新包；O8 的无头 Chrome 检查做成测试（标记版 `ui.json`、375 像素宽、无网络请求），装置先验：先写死一个英文按钮看到红

## 5. skill（提交 5）

- [x] 5.1 `handbook.mjs select`：把 `--features` 的每一项按 id 或功能名解析成 id，不匹配或多匹配时退出 1 并列出全部 id 与名称（D9）；测试先红后绿
- [x] 5.1b `skills/excavator-product-handbook/SKILL.md`：选项、Phase 0 的语言段与 `PLUGIN_ROOT` 解析、地图写作指南（区域、到达方式、`link` 的判定、角色）、lane prompt（条目结构、引文与值的写法、阿拉伯数字、禁词、不读生成文档）、派发与重试、拼装与回复（D9、D10、D12）；非英文时派翻译固定文字表的子代理并跑 `check-ui`
- [x] 5.2 README 的 skill 列表；安装测试与加载夹具里的 skill 计数；skill 契约测试（选项、命令名、lane prompt 的关键规则存在）
- [x] 5.3 O1：三件套、`check-refs`、`legacy-literals`、`openspec validate --all --strict`

## 7. 逐项核对（D14，O6 抽查 6/30 矛盾后提前到本片）

- [x] 7.1 `slices` 与 `verdicts`：核对文件（主张、引文前后各 20 行）、判词守恒、第一轮改写清单、第二轮删项与记录；`slices --round 2` 拒绝改动未列出的项；状态加 `verified`；`assemble`、`page`、`reply` 只把 `verified` 的功能写进正文，覆盖一节列删去的项与核对未完成的功能。测试先红后绿，装置先验
- [x] 7.2 agent 定义 `excavator-handbook-verifier`（只读核对文件、三种判词、一行理由）；插件清单与安装测试
- [x] 7.3 SKILL.md：核对阶段、改写子代理的 prompt、重派规则；lane prompt 要求每项引到能单独证明它的源码；契约测试
- [x] 7.4 `trace` 与 `trace-verdicts`：追查文件（主张、引文的文件与行号，不给代码）、两种判词的守恒、`at` 的路径收敛到项目根内且行号在文件内、理由过禁词门与语言检查；删去 `contradicted` 的项并记 `step: "trace"`；状态加 `confirmed`，`verdicts` 定案后记 `confirmed` 而不是 `verified`；`assemble`、`page`、`reply` 把 `confirmed` 列为核对未完成。测试先红后绿
- [x] 7.5 agent 定义 `excavator-handbook-tracer`（读全项目、只找反证、两种判词、`at` 与一行理由）；插件清单与安装测试
- [x] 7.6 SKILL.md：追查阶段（派发、重派、删项）；契约测试

## 6. 验收（提交 6）

运行前把要用的命令、`--features` 选哪个功能、抽样表的分层写进仓库外的验收笔记；design 的验收记录只写代号与脱敏摘要。

- [ ] 6.1 O6：在 go-multirepo 上以 Sonnet 无人值守运行（`--model sonnet`、`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`、`--out` 在语料外、`--language Chinese`），记录花费、时长与重试次数
- [ ] 6.2 O6 审读：独立的 Sonnet 审读者分别做召回对照（读旧章节）与 30 项分层编造抽查（读源码）；从运行记录中检查有没有读 `.excavator/` 下的生成产物；通读中文固定文字；对运行产出的 `handbook.html` 再做一遍 O8；区域与 domain 的域对照（只记录）
- [ ] 6.3 O7：权限视角探针，记录行数、花费与时长
- [ ] 6.4 把 O1–O8 的结果写进 design 的验收记录；O6 发现的转写错误按值的类别计数，作为是否做确定性抽取器的依据（D5）
