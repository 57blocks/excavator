## 提交序列

1. `docs(openspec): propose view-source-opt-in`
2. `feat(view): leave source out of the page unless --source is given`
3. `docs(openspec): record view-source-opt-in acceptance`

## 1. 实现

- [ ] 1.1 `pack.mjs` 的 `parseArgs` 默认 `noSource: true`，加 `--source`；用法与头部注释改为 `[--source] [--no-source] [--out <path>]`
- [ ] 1.2 `SKILL.md` 的 argument-hint、Options 与命令注释；`README.md` 一行
- [ ] 1.3 测试：命令行默认不嵌、`--source` 内嵌、`--no-source` 与默认相同、两者先后；skill-contract 的参数提示

## 2. 验证

- [ ] 2.1 装置先验：把默认改回内嵌，命令行默认用例变红
- [ ] 2.2 `tests/skill/excavator-view` 全部通过；本地项目实打包，默认与 `--source` 各一次
