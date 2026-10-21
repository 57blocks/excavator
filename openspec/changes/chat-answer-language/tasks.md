## 1. 提案（commit：`docs(openspec): propose chat-answer-language`）

- [ ] 1.1 proposal、design、tasks 与 `canonical-semantic-language` 的规格增量；`openspec validate --all --strict` 通过

## 2. 一条命令选回答语言（commit：`feat(chat): pick the answer language with one command`）

- [ ] 2.1 `request-language.mjs` 加命令行入口：三个信号必填（语言或 `none`）、`--evidence-verified` 必填，打印 `answerLanguage` 与信号；出错时非零退出且 stdout 为空；内部调用 `finalizeVerifiedAnswerLanguage`
- [ ] 2.2 `tests/language/chat-request-language.test.mjs` 加命令行用例：优先序三例、缺 `--evidence-verified`、缺信号、无法识别的语言、重复参数；用例全绿

## 3. 每条路线写答案前选语言（commit：`fix(chat): choose the answer language in every route before writing`）

- [ ] 3.1 `skills/excavator-chat/SKILL.md`：第 0 步信号在读任何内容前判断、用 `none`，`createChatRequestState()` 只用于检查检索表达；第 1 步图谱缺失先解析 `$PLUGIN_ROOT` 并运行第 8 步的语言命令；第 8 步开头放 Answer language；语言门一节改为定义并指向各路线的这一步；改动历史新第 5 步、未用代码新第 4 步，「Product missing」指向它；按需检索 (d) 与诚实降级指向第 8 步
- [ ] 3.2 契约测试：路线枚举与逐字比对、位置、指向、命令真实运行、三份已知坏样本；更新 `test_hotspots_skill_contract` 里随步骤号与措辞变化的断言；`node scripts/check-refs.mjs` 与 `pnpm test` 全绿

## 4. 验收与归档（commit：`docs(openspec): record chat-answer-language acceptance and archive`）

- [ ] 4.1 按 design.md 的 oracle 做真实运行：基线一次，改后三次，总花费 < $2；结果与花费写进 design.md
- [ ] 4.2 同步主规格并归档；`openspec validate --all --strict` 通过
