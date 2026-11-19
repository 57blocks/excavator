## Context

`excavator-prd-report` 与 `excavator-product-handbook` 共用入口清单模块 `skills/excavator-product-handbook/lib/entrypoints.mjs`（`listEntrypoints`）。`prd.mjs entrypoints` 用它的默认值 `useGraph: true`，先读 `.excavator/knowledge-graph.jsonl` 的头行取框架；手册的 `candidates` 传 `useGraph: false`，只按构建文件识别（手册设计 D10）。模块的大部分测试经 `prd.mjs entrypoints` 跑，夹具在 `tests/fixtures/prd-report-pipeline/`。

## Goals / Non-Goals

**Goals:** 删干净 `prd-report` 与只为它存在的代码；入口清单模块的测试覆盖不丢；手册 `candidates` 的输出不变。

**Non-Goals:** 不改 `excavator-prd`（单篇 PRD）与 `prd-generation`；不改归档变更和其他活跃变更里对 `prd-report` 的历史提及；不改 `candidates` 的输出形状或措辞。

## Decisions

### D1 删除范围

删除：`skills/excavator-prd-report/`、`packages/prd-report-page/`、`tests/skill/excavator-prd-report/`、`tests/skill/test_prd_report_skill_contract.test.mjs`、`tests/fixtures/prd-report-pipeline/lanes/`、`tests/fixtures/product-handbook/entrypoints-golden/`（旧的 `prd.mjs entrypoints` 金样）、`openspec/specs/prd-report/`（归档时由 delta 移除）。

改：根 `package.json` 的 `typecheck` 去掉该包；`pnpm-lock.yaml` 随 `pnpm install` 更新；`tests/install/install.test.mjs` 不再期望该 skill；service-only 合约测试不再把该包列为允许的 HTML 包；README 与 `docs/deploy.md` 去掉该 skill 的段落。

### D2 入口清单测试换入口

模块的行为测试改为经 `handbook.mjs candidates` 跑（与真实调用方一致），需要传 `catalogPath` 等命令行不给的参数时直接调 `listEntrypoints`。三个夹具项目 `express-app`、`gin-service`、`react-web` 移到 `tests/fixtures/entrypoints/`，测试共用的小工具（临时目录、复制夹具、写文件、候选键）放到手册测试目录的 helpers 里。只测「从知识图头行取框架」的用例随 D3 删除，其余逐个保留，断言里的格式串改为手册的 `excavator-product-handbook-candidates/1`。

### D3 去掉读知识图的分支

`listEntrypoints` 去掉 `useGraph` 选项和读知识图头行的代码，总是按构建文件识别。为了让 `candidates` 输出逐字节不变，`detection` 仍写 `{"source": "build-files", "graph": "ignored"}`，残余假设仍写原来那句「The knowledge graph is not read …」。代价是这句话里「the caller asked」的说法不再准确；换来的是已有运行目录里的 `candidates.json` 和读它的检查都不用动。

## Oracles（动手前写死）

- **O1 输出不变：** `tests/fixtures/entrypoints-golden/` 下四个金样（express-app、gin-service、react-web、express-app 加 `--scope src/routes`）是本变更动手前用当时的 `handbook.mjs candidates` 生成的，项目根写作 `<ROOT>`。每一步之后 `candidates` 的输出都与它们逐字节相等。金样测试先做一次变异：临时改动输出里的一个字，测试必须变红，再还原。
- **O2 删干净：** `git grep -n 'prd-report'` 在 `openspec/` 以外没有结果；`git grep -n 'useGraph\|readGraphFrameworks'` 没有结果。
- **O3 覆盖不丢：** 迁移后的入口清单测试用例数 = 原来经 `prd.mjs entrypoints` 跑的用例数 − 只测知识图头行的用例数；PR 里逐个列出删掉的用例名。
- **O4 三件套绿：** `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`、`pnpm run typecheck`、`node scripts/check-refs.mjs`、`openspec validate --all --strict`。

## Risks / Trade-offs

- 有人还在用 `/excavator:excavator-prd-report` → 命令消失。用户已决定不需要；README 与 proposal 写明改用手册。
- 删除面大，可能漏掉间接引用 → O2 的全仓 grep 与 O4 的全量测试兜底。
