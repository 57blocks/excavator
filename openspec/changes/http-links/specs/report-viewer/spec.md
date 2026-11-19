## MODIFIED Requirements

### Requirement: 每个产物落进看得见的状态

打包 SHALL 对下列每个产物给出且只给出一种状态，写进页面的 manifest 与打包的结果：
- 知识图谱（`knowledge-graph.jsonl` 及其 `source-manifest.json`）
- 语义（`semantic-cache.json` 与 `semantic-graph.json`：Full 模式写出的摘要、标签与层）
- 领域图（`domain-graph.json`）
- unused-code（`unused-code.json`）
- doc-map（`doc-map.json` 与 `doc-map/checks.json`）
- hotspots（`hotspots.json`）
- 导览（`tour.json`）
- http links（`http-links.json`）

产物文件本身的状态只有下面四种；语义与导览另有一种 **not shown**，见下文：
- **included**：读到并放进页面；
- **not run**：文件不存在。给出生成它的命令；
- **unreadable**：文件存在但读不了或格式不对（不是 JSON、`format` 或版本不是打包认识的版本、缺必需字段）。写出原因，页面 MUST NOT 部分显示它。以下也属于这一类：
  - 领域图的 `version` 不是 `2.0.0`，或 `contentLanguage` 不是 `en`；
  - 语义缓存的 `contentLanguage` 不是 `en`，或语义图的 `factDigest` 与知识图谱的 `factsDigest` 不同；
  - 导览的 `format` 不是 `excavator-tour/1`；
  - http links 的 `format` 不是 `excavator-http-links/1`；
- **different revision**：读到并放进页面，但产物记录的源码版本与打包时源码快照的版本不同。内容照常显示，并写出两个版本。导览例外：它的 `factDigest` 与知识图谱的 `factsDigest` 不同时为 different revision，图里不放它的步骤（步骤里的节点 id 可能已对不上）。

产物没有记录源码版本时，SHALL 为 included 并注明「没有记录版本」，MUST NOT 当作版本相同。

每个产物的状态 SHALL 只判定一次，回复、打包结果与页面用的是同一个判定，所以状态就是页面实际放进去的情况：
- 知识图谱 SHALL 在判定时读全文。正文被拒（例如有不认识的记录类型）时它为 unreadable 并写出原因，与文件头被拒一样：页面不放图，其他产物也不拿它比较（领域图因此为 unreadable，原因是没有可读的知识图谱来比较 `factDigest`）；
- 语义与导览先做完它们自己文件的检查（语义含 `semantic-cache.json` 与 `semantic-graph.json` 的版本、语言与必需字段）。自己的检查不通过时 SHALL 为 unreadable 并写出它自己的原因；
- 自己的检查都通过、但没有可读的知识图谱（不存在、文件头或正文被拒）时，它们没有地方放，SHALL 写为 **not shown**，原因是没有知识图谱可放。

`/excavator-view` 的回复 SHALL 写出每个产物的状态（见「/excavator-view skill」）。页面里，unused-code、hotspots、doc-map 的状态由它们各自的视图写出（见「离线仪表盘的产物视图」）；知识图谱与领域图的版本由页面顶部的版本提示写出（见「离线仪表盘」）；其余产物不在或读不了时，页面照副本自己的空状态显示。

打包 MUST NOT 读取 `hotspots-report.md` 与 `doc-map-report.md`：它们不进页面，读不了也不影响打包。

#### Scenario: 没跑过 hotspots
- **WHEN** `.excavator/` 里没有 `hotspots.json`
- **THEN** 回复把 hotspots 写为 not run；Hotspots 视图写明 not run 并给出 `/excavator-hotspots`，不显示空表

#### Scenario: 没有知识图谱时的语义与导览
- **WHEN** `.excavator/` 里有格式正确的 `semantic-cache.json` 与 `tour.json`，但没有 `knowledge-graph.jsonl`，或它的文件头、正文被拒
- **THEN** 回复把语义与导览写为 not shown，原因是没有知识图谱可放；其中自己的检查不通过的那个（例如 `semantic-graph.json` 缺 `layers`）仍写为 unreadable 并给出它自己的原因，有没有知识图谱都一样

#### Scenario: 产物损坏
- **WHEN** `unused-code.json` 不是合法 JSON
- **THEN** unused-code 的状态是 unreadable 并带原因，页面不显示它的任何条目

#### Scenario: 源码已经前进
- **WHEN** `hotspots.json` 的 `sourceRevision` 与当前源码快照的版本不同
- **THEN** 回复把 hotspots 写为 different revision；Hotspots 视图顶部写出两个版本，表格照常显示

#### Scenario: 领域图语言不对
- **WHEN** `domain-graph.json` 的 `contentLanguage` 不是 `en`
- **THEN** 领域图的状态是 unreadable，原因写明语言，页面没有领域视图

#### Scenario: Lazy 图谱没有语义文件
- **WHEN** `.excavator/` 里没有 `semantic-cache.json`，图谱节点自带摘要
- **THEN** 语义的状态是 not run，给出 `/excavator --full`；节点摘要照常取自图谱

#### Scenario: 没跑过导览
- **WHEN** `.excavator/` 里没有 `tour.json`
- **THEN** 回复把导览写为 not run；图保留知识图谱自己的 `tour`

#### Scenario: 报告文件读不了
- **WHEN** `.excavator/hotspots-report.md` 存在但读不了
- **THEN** 打包照常完成，回复里没有关于它的内容

#### Scenario: 没跑过 http links
- **WHEN** `.excavator/` 里没有 `http-links.json`
- **THEN** 回复把 http links 写为 not run 并给出 `/excavator-http-links`；图里没有请求边

## ADDED Requirements

### Requirement: 图里的请求边

`http-links.json` 为 included 或 different revision 时，图 SHALL 为 `pairs` 里每条 `matched` 的请求画一条边：从请求所在文件，指向处理函数所在文件；没有处理函数时，指向注册行所在文件。
- 同一对文件之间的多条边 SHALL 聚合成一条，并写出条数；
- 边的类型 SHALL 是「请求」，有自己的颜色与图例项，可以和其他边类型一样隐藏；
- 其他桶的请求 MUST NOT 画边。

这些边只在页面里，MUST NOT 写回知识图。

#### Scenario: 前后端连上
- **WHEN** `http-links.json` 里有 3 条 `matched` 的请求，都从 `web/src/api/leave.ts` 指向 `api/internal/handlers/leave.go` 里的处理函数
- **THEN** 图里这两个文件之间有一条请求边，写出 3 条

#### Scenario: 只有冲突的基地址
- **WHEN** 产物里所有请求都在 `base-conflict`
- **THEN** 图里没有请求边；产物状态照常为 included
