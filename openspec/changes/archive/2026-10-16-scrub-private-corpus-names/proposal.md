## Why

仓库是公开的，但四个私有验收语料的真名出现在 79 个跟踪文件里：accepted specs、测试与夹具、skill 注释、agent 指南、活跃变更，以及大部分已归档的变更，还有两个归档目录名和一个夹具文件名。这些名字指向具体公司的项目，不应出现在公开仓库里。

## What Changes

- 四个真名一律换成中性代号（对照见 design.md）。代号描述语料的形态，不指向公司或产品。
- 测试与夹具里的项目名、命名空间、文件名同样替换，包括 C# 夹具里的命名空间与 `.csproj` 文件名，以及选择安全夹具里的归档文件名。
- 两个归档变更目录改名，目录名里不再带真名。
- `AGENTS.md` 与 `openspec/config.yaml` 里「默认真实验收语料」一句改用代号，并写明真名与位置不进仓库。
- 不改任何行为：测试只改数据里的名字，断言的含义不变；specs 只改例子里的名字，需求的含义不变。
- 不改 git 历史：已有提交、PR 标题与正文里的真名，这个变更处理不了。是否改写历史另行决定。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。三个 accepted specs（`source-selection-safety`、`maui-framework`、`angular-framework`）只改场景标题、Purpose 与正文里作为例子的名字，需求不变，所以本变更声明 `skip_specs`，直接改主规格的措辞，不写 delta。

## Impact

- 改动：`openspec/specs/` 的三个规格、`openspec/changes/` 下的活跃变更与归档、`packages/core` 与 `tests/` 的测试数据、一个夹具文件名、`skills/excavator/` 的两处注释、`docs/mcp.md`、`deploy/selftest.sh`、`AGENTS.md`、`openspec/config.yaml`、`.claude/agents/coder.md`。
- 不改产品逻辑、`packages/` 的源码与 MCP。
- 不需要真实运行。
