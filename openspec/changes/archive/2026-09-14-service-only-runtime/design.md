## Decisions

1. **单一服务模式**：不保留 feature flag。删除 `ProjectConfig.terminalOnly` 与配置脚本，避免死配置。
2. **保留空 `tour` 字段**：它仍是 KnowledgeGraph 的兼容形状，但没有生产者；全量和增量路径都写 `[]`。
3. **删除所有浏览器交付面**：`packages/dashboard`、`packages/viewer`、`skills/excavator-dashboard` 整体删除。
4. **删除展示专属数据抓取**：Figma 不再调用 `/images` API，也不存短时效 thumbnail URL。
5. **分析技能继续产出 JSON**：domain、knowledge、figma 与 diff 的核心分析保留，仅移除可视化 overlay 和自动启动行为。

## Acceptance Oracle

- 仓库不存在 Dashboard/Viewer/tour-builder/thumbnail 生产代码。
- 生产提示词不存在 Dashboard skill、浏览器启动或可恢复的展示模式。
- 所有分析路径生成有效 JSON，且结构图 `tour` 为空。
- `pnpm -r build`、`pnpm typecheck`、`pnpm test`、引用检查通过。
- 安装测试只发现 8 个非展示技能。

