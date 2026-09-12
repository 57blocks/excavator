## Why

Excavator 以后只作为代码分析与问答服务运行，不再提供 HTML Dashboard、独立 Viewer、浏览器启动或 guided tour 展示。保留两套运行模式会增加安装体积、构建时间、依赖面和分析分支；`terminalOnly` 开关也因此失去意义。

## What Changes

- 删除 React Dashboard、独立 Viewer、Dashboard skill、tour-builder agent 与对应测试。
- 删除仅供展示使用的 Figma 缩略图抓取、主题配置和大型 Dashboard 样例生成器。
- `/excavator` 永久跳过 tour 生成，输出兼容字段 `tour: []`，完成后只提示使用 `/excavator-chat`。
- 增量分析永久不规划 tour；删除 `terminalOnly` 配置、`--terminal-only` 与 `--with-dashboard`。
- domain、knowledge、figma、diff 等技能保留分析产物，移除 Dashboard overlay/自动启动指令。
- 更新插件元数据、README、构建配置、引用检查和安装测试。

## Impact

- 服务核心保留：源码扫描、知识图谱、架构层、证据验证、增量更新、终端问答。
- 发布物不再包含 HTML/CSS/React、静态资源或本地 HTTP Viewer。
- 现有图谱的 `tour` 字段继续被 schema 接受；新分析始终写空数组，避免无关的 schema 迁移影响问答。

