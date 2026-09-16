# source-index Specification

## Purpose

定义 `source-index.json`——一个 symbol-aware 的词法（BM25）检索索引，把源码切成带符号/行范围/拆分标识符/注释/字符串的 chunk，供混合检索在空 summary 的 Lazy 图谱上仍能定位到代码。它按源码版本持久化，随源码增量而增量。

## Requirements

### Requirement: symbol-aware source chunk 结构

`source-index.json` 中每个 source chunk SHALL 至少记录：`path`、`owner`、`symbol`、行范围（lineRange）、拆分后的 identifier（如 `camelCase`/`snake_case` 切成子词）、注释文本与字符串字面量。索引 SHALL 只由确定性构建产生，不调用模型。

#### Scenario: chunk 携带可检索字段
- **WHEN** 为一个函数/方法建立 chunk
- **THEN** 该 chunk 带 path/owner/symbol/lineRange，以及其标识符子词、注释与字符串，可被词法检索命中

### Requirement: BM25 词法检索

系统 SHALL 在这些 chunk 上提供 BM25（或等价 TF-IDF 家族）词法检索，对给定检索词返回按分数排序的 chunk 候选。

#### Scenario: 词法命中
- **WHEN** 用一组检索词查询索引
- **THEN** 返回按 BM25 分数排序的 chunk（含其 path/symbol/lineRange），供检索层合并

### Requirement: 按 sourceRevision 持久化并增量重建

`source-index.json` SHALL 以 `sourceRevision` 为持久化键；当某文件内容变化（经切片 B 的 sync 检测）时，SHALL 只重建该文件的 chunks，而非整仓重扫。

#### Scenario: 单文件变化只重建其 chunks
- **WHEN** 一个文件内容变化触发 sync
- **THEN** 只该文件的 chunks 被重建，其余 chunk 与索引保持不变
