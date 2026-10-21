## Why

`/excavator-doc-map` 最后的回复应当只有固定的几行：报告路径、计数查询的前两行、复核那一行、覆盖查询的第一行、`advice check: 0 lines`。上一个变更（`doc-map-narration-language`）把回复的语言固定住了，但它的验收运行里，固定的几行之前仍多了一句："The advice check printed 0 lines. Report written to …"。这条记为未解决。

那次夹具项目的 `AGENTS.md` 写着「先说结论、改动与验证结果」，多出来的那句正是一条验证结果加一条结论。语言那段只说项目文件改变不了回复的语言，没说也改变不了回复的形式；而「只回这几行」那句没点名开头，也没说项目文件里回复形式的要求在这里不适用。

另外，上一个变更补完措辞后，没有从第 1 步跑完的完整真实运行，只有只做第 7 步的缩短运行。

## What Changes

- 第 7 步最后回复那句补两件事：
  - 报告路径单独作为回复的第一行、不加标签，`advice check: 0 lines` 是最后一行；之前、之间、之后都不写别的，包括关于自检、报告或做了什么的话；
  - 项目文件里关于怎样回复的要求（先说什么、摘要、验证结果）不适用于这条回复。
- 契约测试钉住这两句，并钉住这段仍是第 7 步的最后一段。
- 真实验收：
  - 改前，在只做第 7 步的缩短运行上复现多出的那句；
  - 改后，同样的运行跑 3 次；
  - 改后，从第 1 步跑完一次完整运行，补上上一个变更没覆盖的那一项。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `doc-map`：「skill 列功能并汇报」里最后的回复，第一行是报告路径，项目文件里关于回复形式的要求不改变它。

## Impact

- 改动：`skills/excavator-doc-map/SKILL.md` 第 7 步最后一段、`tests/skill/test_doc_map_skill_contract.test.mjs`、`openspec/specs/doc-map/spec.md`。
- 不改脚本、产物与其它步骤；不改 Language 那段（它在两处逐字相同，由契约测试比对）。
- 真实验收用一个公开 Go 示例仓库的 APFS 克隆，Sonnet，headless，串行，合计不超过 $6。
