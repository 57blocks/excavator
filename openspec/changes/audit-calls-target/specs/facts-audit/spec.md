## ADDED Requirements

### Requirement: 调用边的目标要是调用点唯一解析到的声明

调用方文件里某个名字的调用点唯一解析到一个声明时，审计 SHALL 只把指向该声明所在文件的模型 `calls` 边算作有抽取记录支撑。指向别处同名声明的边 MUST NOT 得到证据行或被算作匹配；它 SHALL 被标 `verification: "contradicted"`，计入缺口 `edge-target-mismatch`（scope `calls`），样本写出该边、调用点的行与解析到的文件；它同时照旧按没有记录的边计数：模型写了 `extracted` 的计入 `edge-unsupported`，由审计补成 `inferred` 的计入 `edge-auto-inferred`。这样的边 MUST NOT 让被它指错的调用点免于计入 `edge-missing`。有歧义或无法解析的调用点 SHALL 照旧只按调用方文件与名字匹配。模型写的节点、边与字段一律不删不改。

#### Scenario: 指向别处同名声明的边被报出
- **WHEN** `app.ts` 导入 `./helper` 并调用 `helper()`，`other.ts` 也声明了 `helper` 但 `app.ts` 没有导入它，模型画了 `run → other.ts#helper`
- **THEN** 这条边没有证据行，标 `contradicted`，`edge-target-mismatch` 计 1，样本写出 `src/helper.ts`；`edge-missing` 的 `calls` 计入这个调用点

#### Scenario: 对的边与错的边都在时只报错的边
- **WHEN** 同一情形下模型同时画了 `run → helper.ts#helper` 与 `run → other.ts#helper`
- **THEN** 前者照旧 `extracted` 并带调用行，后者计入 `edge-target-mismatch`，这个调用点不计入 `edge-missing`

#### Scenario: 有歧义的调用点照旧
- **WHEN** `app.ts` 同时导入 `./helper` 与 `./other`，两者都声明 `helper`，模型画了 `run → other.ts#helper`
- **THEN** 这条边不标 `contradicted`，不计入 `edge-target-mismatch`
