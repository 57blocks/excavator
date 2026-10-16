## Context

四个真名有三类出现方式：
- 散文：specs、变更文档、注释、指南里把语料当例子或验收对象提到；
- 测试数据：C# 夹具的命名空间与 `.csproj` 路径、选择安全测试里的归档文件名；
- 路径：两个归档变更的目录名、一个夹具文件名。

`pnpm-lock.yaml` 里有一处子串命中，在 integrity hash 里，不是名字，不动。

## Decisions

### D1 代号描述语料的形态

| 语料 | 代号 |
|---|---|
| Go 多仓库语料（含 TS/Vue 前端） | `go-multirepo`；它的成员仓库是 `go-multirepo-auth`、`go-multirepo-service-v2` |
| C#、Kotlin、TypeScript 混合语料 | `mixed-suite` |
| 混合语料里的 MAUI 应用 | `maui-app`；夹具里它的 C# 命名空间与 `.csproj` 名是 `SampleApp` |
| 混合语料里的 Kotlin + Angular 门户 | `kotlin-portal` |

代号在改前的仓库里都没出现过，所以替换后可以按次数核对。备选方案是 `corpus-a` 这类无意义编号，没采用：归档文档里「Go 语料全部 `undetermined`」这类句子靠语料形态才读得懂。

### D2 按固定顺序做确定性替换

替换用脚本按顺序做，先长后短、先大写后小写，名单放在仓库外：
1. 门户的完整仓库名换成 `kotlin-portal`，剩下的门户短名也换成 `kotlin-portal`；
2. MAUI 应用名的全大写形式（C# 标识符）换成 `SampleApp`，其余形式换成 `maui-app`；
3. 混合语料名的全大写形式（环境变量名）换成 `MIXED_SUITE`，其余形式换成 `mixed-suite`；
4. Go 语料名换成 `go-multirepo`。

路径用 `git mv` 按同一规则改名。脚本之外不手改，测试标题与断言里的名字也走同一规则，保证引用两端一致。

### D3 不改历史

已有提交、PR 标题与正文里的真名留在 git 历史里。改写公开仓库 `main` 的历史要强推，还会让已有的克隆与 fork 失效，不在本变更里做。

## Risks / Trade-offs

- [测试里文件名换了，断言跟着换] → 两端走同一条规则；测试数与改前相同才算通过。
- [代号让以后的验收记录读起来要对照] → 真名与代号的对照只放在仓库外。

## 验收 Oracle（动手前写死）

- **O1 无残留**：用仓库外的名单（四个真名）对 `git ls-files` 的全部文件做不区分大小写的子串搜索，只剩 `pnpm-lock.yaml`，且那一处在 integrity hash 里；对 `git ls-files` 的路径做同样的搜索，结果为空。
  - 先验装置：改前同一套命令列出 80 个文件（79 个加 `pnpm-lock.yaml`）、15 个路径。
- **O2 替换一致**：每个代号改后的出现次数（不算本变更自己的文档），等于脚本对它做的替换次数；改前每个代号出现 0 次。
- **O3 行为不变**：core 测试 1417 个通过；仓库 3594 个通过、4 个跳过；typecheck、check-refs、`openspec validate --all --strict` 通过。
- **O4 提交与 PR**：本变更的提交信息与 PR 正文用同一名单搜索，结果为空。
