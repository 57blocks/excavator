# domain-freshness Specification

## Purpose

给显式 Domain 分析的产物加新鲜度键，使消费端只使用与当前事实层一致的 Domain 数据，过期的领域叠加不污染回答。

## Requirements

### Requirement: Domain 产物记录新鲜度键

`domain-graph.json` SHALL 记录产出时的 `sourceRevision` 与 `factDigest`。

#### Scenario: Domain 产物带 revision + factDigest
- **WHEN** 运行显式 Domain 分析
- **THEN** `domain-graph.json` 记录当时的 `sourceRevision` 与 `factDigest`

### Requirement: 过期 Domain 不进回答

消费端 SHALL 只读取 `sourceRevision`/`factDigest` 与当前事实层一致的 Domain；不一致（过期）的 Domain MUST NOT 进入回答。domain/flow/step 仍是语义提示，回答业务流程时 SHALL 用 fact graph 与源码证据核对。

#### Scenario: 过期 Domain 被忽略
- **WHEN** `domain-graph.json` 的 revision/factDigest 与当前事实层不一致
- **THEN** 回答不使用该 Domain，并按需提示可重跑 Domain 分析

#### Scenario: 一致的 Domain 仅作提示并回源核对
- **WHEN** Domain 与当前事实层一致且用于回答业务流程
- **THEN** 其 domain/flow/step 作为提示，最终结论回 fact graph / 源码核对后才进入答案
