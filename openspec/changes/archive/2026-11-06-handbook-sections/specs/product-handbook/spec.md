## ADDED Requirements

### Requirement: 手册的部分

手册 SHALL 由几个部分组成，每个部分可以单独选择：`overview`（系统概览）与 `features`（功能条目）。`--sections <list>` 选择这次运行的部分，不给时为全部。

每个部分的阶段文字 SHALL 放在 skill 目录下它自己的文件里，只在选中时读。概览与功能共同依赖的地图阶段 SHALL 放在一个阶段文件里，只要选了依赖它的部分就读一次。要读哪些文件、按什么顺序，SHALL 由 `handbook.mjs sections` 按固定的依赖表打印，不由模型推断。

没选的部分的阶段 SHALL NOT 运行。第 5、6 阶段 SHALL 只处理所选部分的单元。

拼装 SHALL 不受 `--sections` 影响：输出目录里已有的都拼进去，没写的部分照旧有可见的说明。

#### Scenario: 只写概览
- **WHEN** 以 `--sections overview` 运行
- **THEN** 地图与概览照常写、核对与追查，不派发任何功能条目的子代理，也不读功能部分的文件

#### Scenario: 非法的部分名
- **WHEN** `--sections data,overview` 中有一个不认识的值
- **THEN** `handbook.mjs sections` 退出 1，并打印可选值

#### Scenario: 默认运行
- **WHEN** 不给 `--sections`
- **THEN** 读地图、概览与功能三个文件，各阶段的文字与改前逐字相同，运行结果与改前相同
