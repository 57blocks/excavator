## 1. 核对并记录对应（commit：`feat(doc-map): check and record the code each unit is tied to`）

- [x] 1.1 `doc-map.py link`：读对应清单；逐条核对序号、状态与证据、`searched`、路径规则（项目内、普通文件、不在 `.git`/`.excavator`/文档目录、不是文档扩展名、内容不同于已读文档）、代码段恰好出现一次（统一处理，Latin-1 回退）；一次报出全部问题；全部通过才写入；行号、`not-checked`、三种计数、代码基线。验证：`tests/skill/test_doc_map.test.mjs` 里 `link` 的单测全绿
- [x] 1.2 产物字段：`code`、`counts.found`/`notFound`/`notChecked`、每条功能的 `code`；`read` 与 `units` 写 `null`；残余假设加两条。验证：单测断言三步之后的字段与清回 `null`
- [x] 1.3 单测覆盖 design.md「Oracle · 单测」的每一项；源码零中文字符。验证：`pnpm vitest run tests/skill/test_doc_map.test.mjs` 全绿，变异（去掉唯一性、去掉项目内检查、去掉文档内容比对、去掉 `not-checked`）各自让测试变红

## 2. skill（commit：`feat(skill): tie doc-map units to code`）

- [ ] 2.1 `skills/excavator-doc-map/SKILL.md`：新增「对到代码」一步（分批与行范围、子代理提示词、合并、运行 `link`、按报错改的规则）；报告增加状态计数、每份文档的分状态条数、每条功能的证据位置、`not-found` 搜过的内容；固定写法不说「已实现」「未实现」；描述与参数说明更新。验证：契约测试
- [ ] 2.2 `README.md` 里这条命令的说明改为也对到代码。验证：读一遍 diff
- [ ] 2.3 契约测试：分批命令的批次与行范围、合并顺序、报告查询在带对应的夹具产物上的输出、自检报出「implemented」类词、源码零中文字符；关键规则的变异各自变红。验证：`pnpm vitest run tests/skill/test_doc_map_skill_contract.test.mjs` 全绿

## 3. 验收与归档（commit：`docs(openspec): record doc-map-link acceptance and archive`）

- [ ] 3.1 先验装置：改坏真实对应清单里的几处证据，`link` 全部报出
- [ ] 3.2 真实模型运行：maui-app 标定，然后 go-multirepo、sakai、病历系统；陷阱文档必须是 `not-found`；记花费、轮数、时长、三种状态的计数
- [ ] 3.3 精度抽查（错归属必须为 0）与 `not-found` 重搜（漏判照实记）
- [ ] 3.4 全量门在分离检出里跑；验收记录写进 design.md，同步主规格并归档
