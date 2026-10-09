提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

0. `docs(openspec): propose runner-image-release-only`：本变更的 proposal、design、规格增量、tasks。
1. `ci: build the runner image only on release triggers`：任务 1.1、1.2。
2. `docs(openspec): record runner-image-release-only acceptance and archive`：任务 2.1 的结果、任务 3.1。

## 1. 实现

- [x] 1.1 在 `.github/workflows/runner-image.yml` 的 `image` 任务上加 D1 的发布触发白名单 `if`，同步改写文件头与 `image` 任务前的说明；触发器、`test` 任务、推送资格判定不动。验证：YAML 能解析，且 diff 只涉及该 `if` 与注释。
- [x] 1.2 改写 `docs/deploy.md` §12 首段：PR 只跑测试门，镜像构建、自检与推送只在 tag 与手动 dispatch 下运行；合入前验证镜像用 §5 的本地构建与自检。验证：`vitest run tests/deploy` 通过（含文档契约测试）。

## 2. 验收

- [ ] 2.1 本变更 PR 的 CI 运行里 `Test` 通过、`Image (linux/amd64)` 显示为 skipped；记录运行 id。

## 3. 归档

- [ ] 3.1 规格增量同步到 `openspec/specs/runner-image/spec.md`，变更移入 `openspec/changes/archive/`，`openspec validate --all --strict` 通过。
