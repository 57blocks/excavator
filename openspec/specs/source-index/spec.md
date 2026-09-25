# source-index Specification

## Purpose

定义 source index（持久化为 `.excavator/source-index.jsonl`）——一个 symbol-aware 的词法（BM25）检索索引，把源码切成带符号/行范围/拆分标识符/注释/字符串的 chunk，供混合检索在空 summary 的 Lazy 图谱上仍能定位到代码。它按源码版本持久化，随源码增量而增量。

## Requirements

### Requirement: symbol-aware source chunk 结构

持久化的 source index 中每个 source chunk SHALL 至少记录：`path`、`owner`、`symbol`、行范围（lineRange）、拆分后的 identifier（如 `camelCase`/`snake_case` 切成子词）、注释文本与字符串字面量。索引 SHALL 只由确定性构建产生，不调用模型。

#### Scenario: chunk 携带可检索字段
- **WHEN** 为一个函数/方法建立 chunk
- **THEN** 该 chunk 带 path/owner/symbol/lineRange，以及其标识符子词、注释与字符串，可被词法检索命中

### Requirement: BM25 词法检索

系统 SHALL 在这些 chunk 上提供 BM25（或等价 TF-IDF 家族）词法检索，对给定检索词返回按分数排序的 chunk 候选。

#### Scenario: 词法命中
- **WHEN** 用一组检索词查询索引
- **THEN** 返回按 BM25 分数排序的 chunk（含其 path/symbol/lineRange），供检索层合并

### Requirement: 按 sourceRevision 持久化并增量重建

source index SHALL 持久化为 `.excavator/source-index.jsonl`，并以 `sourceRevision` 为持久化键；当某文件内容变化（经切片 B 的 sync 检测）时，SHALL 只重建该文件的 chunks，而非整仓重扫。系统 MUST NOT 读取旧格式的 `source-index.json`；发布新索引时 SHALL 删除残留的旧文件。

#### Scenario: 单文件变化只重建其 chunks
- **WHEN** 一个文件内容变化触发 sync
- **THEN** 只该文件的 chunks 被重建，其余 chunk 与索引保持不变

#### Scenario: 只剩旧格式的索引文件
- **WHEN** 数据目录里只有旧的 `source-index.json`
- **THEN** 读取方把 source index 视为缺失并以可见缺口报告，不解析旧文件；下一次成功发布删除该旧文件

### Requirement: 持久化不受单字符串上限约束且往返无损

source index 的持久化 SHALL 使写入与读取都不需要把整个索引放进单个字符串：每条记录独立成行、单独解析，一条记录只承载一个 chunk 或一个词项的倒排表，因此单行长度至多与单个词项出现的 chunk 数成正比，而不是与整份索引成正比。倒排表 SHALL 用 chunk 在索引中的序号引用 chunk，MUST NOT 为每条 posting 重复 chunk 的标识字符串。读回的内存索引 SHALL 与构建产生的索引严格深度相等，因此同一组检索词的检索结果与改格式前完全相同。读取时 SHALL 校验文件头、记录数与序号范围；校验失败 SHALL 以可见的无效产物缺口报告，MUST NOT 静默返回部分索引。

#### Scenario: 往返严格相等
- **WHEN** 把一份构建好的索引持久化后再读回
- **THEN** 读回的索引与原索引严格深度相等，同一组检索词的 BM25 结果逐项相同

#### Scenario: 索引总量超过单字符串上限
- **WHEN** 一个仓库的 source index 若整体序列化会超过运行时单字符串上限
- **THEN** 持久化与读取仍然成功，文件中没有任何一行接近该上限

#### Scenario: 截断或损坏的索引文件
- **WHEN** 索引文件缺少文件头、实际记录数与文件头声明不符，或某个序号越界
- **THEN** 读取方报告无效产物缺口，不返回部分索引
