## 1. 提案（提交 1）

- [x] 1.1 proposal、design（含 oracle O1–O4）、spec、tasks；`openspec validate --all --strict`

## 2. 规则与装置（仓库外装置，先于提交实现）

- [x] 2.1 `agents/excavator-handbook-tracer.md`：按 D1–D3 加按原话造例子的一步、页面主张过服务端、判法三条、`holds` 理由两句；例子保持中性（D4）；源码零非 ASCII 字符
- [x] 2.2 O1 装置：`handbook-dual-tracer` O1 的追查文件、真值表与语料副本；追查者定义取 2.1 的 agent 文件原文；两次重复、每份两名 Sonnet，按「或」打分，按 O1 的通过条件判定；其余 `contradicted` 逐条对照源码

## 3. 实现（提交 2）

- [x] 3.1 `tests/skill/test_product_handbook_skill_contract.test.mjs` 的追查者一节加断言（新步骤、判法、理由要求）；先在旧定义上看到红，再在新定义上看到绿
- [x] 3.2 O4：受影响测试、`check-refs`、`openspec validate --all --strict`

## 4. 真实验收（提交 3）

- [x] 4.1 O2 的只追查运行（插件取本分支），记录花费、时长、删去的项与每项真假
- [x] 4.2 O3 的 Opus 30 项分层抽查（新种子）；残余逐条对照源码
- [x] 4.3 把 O1–O4 的结果写进 design 的验收记录（只写代号与脱敏摘要）
