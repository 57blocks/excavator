## MODIFIED Requirements

### Requirement: 受约束的测量运行

`scripts/benchmark-full-run.mjs run` SHALL 在以下约束下运行一次无头 Full，然后对它的记录出报告：
- `--model` 与 `--max-budget-usd` 必填，缺任一则不启动；
- 样本复制到一个新建的、只含样本与空工作目录的临时目录，样本目录名不含 `test`、`fixture` 一类字样；
- 插件从本仓库检出加载，工作目录是那个空目录，不在样本里；
- 运行记录与报告写到调用者给的输出目录，不写进样本所在的目录树。

此外：
- `--continue <工作目录>` SHALL 复用上一次 `run` 建的隔离目录，不重新复制；该目录必须正好含样本副本与 `cwd`。
- `--timeout-minutes <n>` SHALL 在 n 分钟后停止无头进程，像 runner 超时那样，报告照出。
- `--skill-args` SHALL 原样追加到 `/excavator` 的参数后面。
- 运行结束后，SHALL 把 F2 的选择与分批、F4 的核验清单和 `semantic-cache.json` 拷进输出目录。

#### Scenario: 缺预算不启动
- **WHEN** 调用 `run` 时给了 `--model` 但没给 `--max-budget-usd`
- **THEN** 命令以用法错误退出，不调用模型

#### Scenario: 样本与验收文件隔离
- **WHEN** 样本源目录的同级目录里有预注册或报告文件
- **THEN** 无头运行看到的项目根所在目录树里只有样本副本与空工作目录

#### Scenario: 续用上一次的副本
- **WHEN** 用 `--continue` 指向上一次 `run` 建的目录
- **THEN** 无头运行的项目根就是那份副本，副本里上一次的 `.excavator/` 原样保留
