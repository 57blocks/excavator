## ADDED Requirements

### Requirement: 入口点来自事实层

`extract-domain-context.py` SHALL 从知识图的 `entryPoints` 流读 HTTP 与 UI 入口点（`source: "script"`），MUST NOT 再用自己的 HTTP 正则产生入口点。入口点归属的文件 SHALL 是处理者所在文件（处理者解析到节点或模块时），否则是注册文件。CLI、事件、定时、导出处理者四类正则照旧产生入口点（`source: "pattern"`）。

原 HTTP 正则 SHALL 只用作「像处理者的代码」检测：命中行不是任何 `entry` 或 `mount` 记录的注册行时，该文件进 `unrecognisedFiles`，带命中行与写法。

没有知识图或传了 `--full` 时，skill SHALL 先跑确定性的 Lazy 构建再抽取。知识图仍读不到时，产物 SHALL 记入口点来源为 `unavailable`，HTTP 入口点为 0，并告诉用户；MUST NOT 回退到正则。

#### Scenario: 事实层的 Gin 入口点进入模块
- **WHEN** 知识图有一个入口点，注册在 `svc/handlers/handlers.go`，处理者是 `svc/handlers/support/positions.go` 的函数节点
- **THEN** 抽取产物里该入口点的 `file` 为 `svc/handlers/support/positions.go`，`svc/handlers/support` 模块的入口点数加一

#### Scenario: 规则没认出的路由
- **WHEN** 一个文件里有 `@app.route('/orders')`，知识图里没有该文件该行的记录
- **THEN** 该文件进 `unrecognisedFiles`，不产生脚本入口点

### Requirement: 脚本未识别文件的模型补充

区上下文 SHALL 带本区的 `unrecognisedFiles`。分析器 SHALL 只为这些文件在输出 `entryPoints` 里写模型找到的入口点，每条带 `file`、`line`、`method`、`path` 与 `quote`。合并 SHALL 逐条核对：文件是本区的未识别文件、行在文件内、`quote` 去掉首尾空白后非空、不长于 200 个字符且是该行源码的子串；通过的记 `source: "model"`，不通过的按原因（`file-not-unrecognised`、`line-out-of-range`、`quote-mismatch`）计数并拒收。

覆盖报告 SHALL 分开给出脚本、正则、模型（通过与各原因拒收）的入口点数，逐模块也分开给出。模块没有流程、没被声明跳过，且有入口点（任一来源，模型只算通过的）或有未识别文件时，SHALL 为 `silent-zero`。

#### Scenario: 引文对不上
- **WHEN** 分析器为未识别文件写了一条入口点，`quote` 不在它给的那一行
- **THEN** 该条被拒收，`model.rejected.quote-mismatch` 加一，不进合并结果

#### Scenario: 未识别文件的模块被忽略
- **WHEN** 一个模块只有一个未识别文件，分析器没为它写流程，也没声明跳过
- **THEN** 该模块为 `silent-zero`，不是 `no-candidates`
