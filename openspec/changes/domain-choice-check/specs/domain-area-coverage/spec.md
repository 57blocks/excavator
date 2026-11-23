## ADDED Requirements

### Requirement: 区输出的选域检查

`merge-domain-areas.mjs` 接受区输出时，在令牌与解析检查之后，SHALL 对每条起始于需选域模块（规划标为 `mixed`，或归在支撑域）的流程检查选择；起始模块的求法 MUST 与流程挂接相同。流程的 `domainMeta.domain` 不是规划里的域 id，或 `domainMeta.domainReason` 去空白后为空时，该区 SHALL 记为 `rejected-choice`，内容 MUST NOT 进入合并结果，退出码 SHALL 为 3，并 SHALL 为每条这样的流程打印一行，写明区、流程、起始模块、问题（`missing`、`invalid` 或 `no-reason`）与规划的全部域 id。每个区上下文 SHALL 带 `check`：只读地对该区做同样检查的命令，接受时退出 0，否则退出 3 并打印同样的行；分析器 SHALL 在返回前运行它并按这些行补选。合并 SHALL 提供 `--accept-unchosen`：只放行仅未通过选域检查的区，区结果带 `unchosen` 列表，区行打印 `unchosen=<n>`，未选的流程按流程挂接的回落规则定域并计数。`/excavator-domain` SHALL 先对 `rejected-choice` 的区重派一次（提示词带该区的 `rejected-choice` 行）并重跑合并，仍被拒时才 SHALL 使用 `--accept-unchosen`。

#### Scenario: 混合目录里没选的流程
- **WHEN** 一条流程起始于规划标为 `mixed` 的 `legacy/routes`，没有写 `domainMeta.domain`
- **THEN** 该区为 `rejected-choice`，打印的行点名该流程、`legacy/routes`、`problem=missing` 与规划的全部域 id，合并结果没有该区的流程，回落计数为 0

#### Scenario: 补选后接受
- **WHEN** 同一流程写了规划里的 `domain:invoices` 与一句理由
- **THEN** 区上下文的 `check` 打印 `area-001 accepted` 并退出 0，该区被接受，流程挂在 `domain:invoices` 下

#### Scenario: 选了支撑域却没写理由
- **WHEN** 一条起始于支撑域模块的流程选了该支撑域，`domainMeta.domainReason` 为空白
- **THEN** 该区为 `rejected-choice`，该流程的问题为 `no-reason`

#### Scenario: 回落只在显式放行后出现
- **WHEN** 重派后该区仍为 `rejected-choice`，合并以 `--accept-unchosen` 运行
- **THEN** 该区被接受，区行打印 `unchosen=1`，该流程回落到起始模块的域，`fallback.missing` 为 1

#### Scenario: 通过检查的区不会回落
- **WHEN** 一个区的需选域流程都写了规划域 id 与理由
- **THEN** 合并后 `fallbackMissing`、`fallbackInvalid`、`choicesWithoutReason` 与 `support.unchosen` 都是 0
