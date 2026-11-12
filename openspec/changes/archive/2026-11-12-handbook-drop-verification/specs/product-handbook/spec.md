## ADDED Requirements

### Requirement: 只保留技能调用的命令与子代理

产品手册脚本 SHALL 只提供技能文字调用的命令；技能 SHALL 只带它派发的子代理。状态 `confirmed` 与 `verified` SHALL 仍被当作已完成。

#### Scenario: 不再有核对命令

- **WHEN** 运行 `handbook.mjs verdicts`
- **THEN** 报告未知命令，退出 2

#### Scenario: 旧输出目录

- **WHEN** 输出目录里有 `verified` 的功能
- **THEN** 组装与页面照旧把它当作已写
