## 1. 规格

- [x] 1.1 写 proposal、design 与 report-viewer 的增量规格，`openspec validate --all --strict` 通过

## 2. 实现

- [ ] 2.1 模式按钮（顶栏与手机抽屉）只在没有产物视图时按 `viewMode` 高亮
- [ ] 2.2 产物按钮只开不关，去掉 `toggleProductView`
- [ ] 2.3 默认视角 Overview；领域图第一次到达时默认 Domain
- [ ] 2.4 主题存储键改为 `excavator-explorer-theme`
- [ ] 2.5 有差异覆盖层时 Diff 默认关闭
- [ ] 2.6 单元测试覆盖 design 的 Oracle 各条

## 3. 验收

- [ ] 3.1 构建模板，换进一个真实语料的 `explorer.html`（数据块逐字节不变），在浏览器里按 Oracle 检查
