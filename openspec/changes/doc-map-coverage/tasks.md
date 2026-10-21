## 1. 代码一侧的计数（commit：`feat(doc-map): count the code each unit's evidence is in`）

- [x] 1.1 「是不是文档」的三条规则抽成一个函数，`link` 改用它，行为不变。验证：`tests/skill/test_doc_map.test.mjs` 里已有的 `link` 单测原样全绿
- [x] 1.2 `doc-map.py coverage`：读事实图头部与文件节点（格式、节点记录数、重复路径不对就报错）和 `source-manifest.json` 的 `sourceRevision`；每个文件分进 `documents`、有证据、没有证据；证据路径规范化，对不上的单列；每级目录的计数与功能序号；守恒不成立就报错；没有 `link` 或没有事实就报错；产物 `coverage` 写入。验证：单测
- [x] 1.3 产物：`read`、`units`、`link` 把 `coverage` 清回 `null`；残余假设加一条。验证：单测断言各步之后的 `coverage`
- [x] 1.4 单测覆盖 design.md 验收 oracle 第 1 条的每个桶；源码零中文字符。验证：`pnpm vitest run tests/skill/test_doc_map.test.mjs` 全绿，变异（祖先目录不累加、不规范化路径、不分出文档、不查重复路径）各自让测试变红

## 2. skill（commit：`feat(skill): report the code with and without evidence`）

- [x] 2.1 `skills/excavator-doc-map/SKILL.md`：第 1 步开头检查事实，缺失或过期时运行 `/excavator --mode=lazy`，仍不新鲜时记下原因；复核之后新增一步运行 `coverage`；报告增加计数、第一级目录、没有证据而父目录有证据的目录（带总数）、单列的证据、固定的话、没有计数时的原因；自检加「undocumented」类词；描述更新。验证：契约测试
- [x] 2.2 `README.md` 里这条命令的说明加上计数。验证：读一遍 diff
- [x] 2.3 契约测试：事实检查在读文档之前且写明 `--mode=lazy`；报告查询在带 `coverage` 的夹具产物上的输出（最上层的没有证据目录、总数）；固定的话过自检；关键规则的变异各自变红。验证：`pnpm vitest run tests/skill/test_doc_map_skill_contract.test.mjs` 全绿

## 3. chat（commit：`feat(chat): answer document questions from the doc map`）

- [ ] 3.1 `skills/excavator-chat/SKILL.md`：路由里加一条「文档问题」，新一节写产物缺失、计数为 `null`、过期比对、固定查询与措辞规则。验证：契约测试
- [ ] 3.2 契约测试（放在 `test_doc_map_skill_contract.test.mjs`）：这一节的查询在夹具产物上的输出、过期比对的两条命令、措辞规则；源码零中文字符。验证：契约测试全绿

## 4. 验收与归档（commit：`docs(openspec): record doc-map-coverage acceptance and archive`）

- [ ] 4.1 先验装置（oracle 第 1 条）的结果记入验收记录
- [ ] 4.2 四个语料的真实产物独立重算（oracle 第 2 条）
- [ ] 4.3 maui-app 一次完整的真实运行（oracle 第 3 条）
- [ ] 4.4 chat 的真实问答（oracle 第 4 条）
- [ ] 4.5 全量门在分离检出里跑；验收记录写进 design.md，同步主规格并归档
