## ADDED Requirements

### Requirement: 一次读代码写出全部文件

运行 SHALL 为每个功能派一个写作子代理，由它写这个功能的正文、事实表，以及选了 `findings` 时这个功能的问题文件。运行 SHALL 为系统层派一个写作子代理，由它写本次选中的概览、架构章与架构事实表、每个应用的系统问题文件。每份文件 SHALL 由各自的检查命令检查并各自记录状态；重派 SHALL 只要求写没有通过的文件。

#### Scenario: 全量运行里每个功能只派一次

- **WHEN** 一次运行选了 `features` 与 `findings`，一个功能的正文与问题文件都一次通过检查
- **THEN** 这个功能只有一次写作派发，两个单元都记为 `checked`

#### Scenario: 只重写不过的那份

- **WHEN** 一个功能的正文通过检查、问题文件没有通过
- **THEN** 重派的子代理只被要求写问题文件，正文的状态不变

#### Scenario: 系统层只派一次

- **WHEN** 一次运行选了 `overview`、`architecture` 与 `system-findings`
- **THEN** 系统层只有一次写作派发，`sections` 只读一次 `sections/system.md`
