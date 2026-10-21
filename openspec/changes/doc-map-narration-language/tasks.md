## 1. 提案（commit：`docs(openspec): propose doc-map-narration-language`）

- [ ] 1.1 proposal、design、tasks 与 `doc-map` 的规格增量；`openspec validate --all --strict` 通过

## 2. 语言规则写在写给用户的步骤里（commit：`fix(doc-map): write every line to the user in the report language`）

- [ ] 2.1 契约测试：`languageRuleProblems` 与已知坏样本；改 skill 前在主线 skill 上跑，记下它报出的问题
- [ ] 2.2 `skills/excavator-doc-map/SKILL.md`：第 1 步开头与第 7 步最后回复之前放同一段 **Language**，第 2–7 步开头一句指回它，选项一节只看 `--language`；更新原有的选项一节断言
- [ ] 2.3 `node scripts/check-refs.mjs` 与 `pnpm test` 全绿；本分支新增内容中文字符为 0

## 3. 验收与归档（commit：`docs(openspec): record doc-map-narration-language acceptance and archive`）

- [ ] 3.1 按 design.md 的 oracle 做真实运行，结果与花费写进 design.md
- [ ] 3.2 全量门在独立检出上逐个 commit 跑，结果写进 design.md
- [ ] 3.3 同步主规格并归档；`openspec validate --all --strict` 通过
