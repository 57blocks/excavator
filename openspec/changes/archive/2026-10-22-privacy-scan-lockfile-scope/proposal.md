## Why

隐私检查的代码让两份名单都不扫根目录的 `pnpm-lock.yaml`：语料名的路径范围是在私有名字的范围上再排除 `openspec/`、`docs/` 与根目录 Markdown，私有名字的范围本来就排除了 lockfile。脚本开头的说明与 `change-review` 主规格却只给私有名字开了这个例外，按它们的说法，语料名在 lockfile 里也禁止。三处说法不一致，现有测试也没有覆盖语料名在 lockfile 里的情形：把语料名范围里的 lockfile 例外去掉，测试照样全绿。

ci-merge-gate 的设计只为私有名字写了理由：lockfile 里是随机的完整性哈希，短名字会偶然命中。同一个理由对语料名同样成立，而且一条正则可以比一个固定字符串宽得多。

## What Changes

- 保留代码现有的行为：两份名单都不扫根目录的 `pnpm-lock.yaml`。
- 脚本开头的说明改为两份名单都跳过 lockfile，并写明理由。
- 主规格「隐私检查不把名单写进仓库」改为两份名单都跳过根目录的 `pnpm-lock.yaml`，写明理由，并加一个场景。
- 测试新增一例：同一行哈希写进 lockfile 与一个代码文件，语料名只在代码文件那一处计为命中。去掉语料名范围里的 lockfile 例外，这一例变红。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `change-review`：「隐私检查不把名单写进仓库」写明两份名单都不扫根目录的 `pnpm-lock.yaml` 与理由；新增「lockfile 里偶然命中的语料名」场景。

## Impact

- 改动：`scripts/ci/privacy-scan.mjs` 的开头说明与一行注释（不改逻辑）、`tests/ci/privacy-scan.test.mjs`、`openspec/specs/change-review/spec.md`。
- 改到 `scripts/ci/`，按风险分级属于高风险，由用户合并。
- 隐私检查的扫描结果不变：代码行为不变，只是说明、规格与测试跟上代码。

执行约束：
- 代码、注释与测试用英文，零中文字符；OpenSpec 文档用中文。
- 仓库里任何地方都不写私有名字与语料名；测试只用合成名单。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose privacy-scan-lockfile-scope`
2. `test(ci): show the privacy scan skips the lockfile for corpus patterns too`：任务 1.1。
3. `docs(ci): say in the privacy scan's header that both lists skip the lockfile, and why`：任务 1.2。
4. `docs(openspec): record privacy-scan-lockfile-scope acceptance and archive`：任务 2.1–2.3。
