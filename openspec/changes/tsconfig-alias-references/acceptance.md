# 验收记录：tsconfig-alias-references

验证对象是 `extract-import-map.mjs`、`coverage-ledger.mjs` 与 `prepare-incremental.mjs`，只读夹具源码、不编译、不装依赖。判据在动手前写死（见 `design.md` 的 Oracle）。

## 1. 先验装置

新用例先在旧代码上跑：

| 文件 | 新用例 | 旧代码上红 |
|---|---:|---:|
| `test_extract_import_map.test.mjs`（`tsconfig references and extends`，前 11 个） | 11 | 11 |
| 同文件既有的 `stats` 精确比对（新增两项计数） | 1 | 1 |
| `test_coverage_ledger.test.mjs`（`imports-ambiguous`） | 1 | 1 |
| `test_prepare_incremental.test.mjs`（只改共享基础配置） | 1 | 1 |

新代码上三个文件全部绿。变异检查之后又补了 2 个用例（见第 3 节），`test_extract_import_map.test.mjs` 共 81 个用例。

## 2. 端到端

Vite 布局夹具（根 `tsconfig.json` 为 `files: []` 加两个 `references`，`tsconfig.app.json` 带注释与尾逗号，`src/App.tsx` import 两个 `src/...` 别名模块、一个相对模块），在临时 git 仓库里跑 `lazy-analyze.mjs`：

| | 旧脚本 | 新脚本 |
|---|---:|---:|
| `src/App.tsx` 的 `imports` 边 | 1（只有 `./local`） | 3 |
| `imports-unresolved`（typescript） | 2：`src/common/components`、`src/utils/format` | 无 |
| import map `failures` | 0 | 0 |

被引用的 `tsconfig.app.json` 经源码快照到达 import map（快照包含它），所以修复在 `lazy-analyze` 的真实路径上生效，不只在脚本单测里。

## 3. 变异

每条新规则改坏一次，在三个测试文件上跑，要求至少一个用例变红：

| 变异 | 结果 |
|---|---|
| 去掉「被引用配置只作用于自己目录」 | 被拦（1 红） |
| 歧义改为取第一个结果 | 被拦（2 红） |
| 歧义说明符不从 `unresolved` 去掉 | 被拦（2 红） |
| 不跟随 `references` | 被拦（10 红） |
| `baseUrl` 改锚定在子配置目录 | 被拦（2 红） |
| 去掉字面路径的越界检查 | 被拦（1 红） |
| 不跟随 `extends` | 被拦（4 红） |
| 去掉成环检查（改成深度上限） | 被拦（1 红） |
| 告警不去重 | 第一次**存活**：解析失败本来就按路径缓存，去重只对告警起作用。补「两个被引用配置共享的基础配置里坏掉的 `extends` 只告警一次」后被拦（1 红） |
| 去掉 realpath 越界检查 | 第一次没有用例；补「符号链接指向根目录外的被引用配置」后被拦（1 红） |
| `tsConfigFiles` 输出为空 | 被拦（1 红） |
| 增量运行不看 `tsConfigFiles` | 被拦（1 红） |

全部 12 个变异最终被拦。变异在工作区副本上做，每次从备份还原并用 `cmp` 核对。

## 4. 残余与局限

- 文件归属用「被引用配置的目录」近似 `include`，见 `design.md` 第 1 条；越出自己目录的 `include` 拿不到别名，留在 `unresolved`。
- 只跟随一层 `references`；包名 `extends` 不跟随。
- 没有在私有语料上复跑：触发这个缺陷的语料不在本机，修复以夹具与端到端夹具为准。
