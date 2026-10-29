## 1. 浏览页主题

- [x] 1.1 `packages/explorer/src/themes`：加 Dark Violet、Light Violet 预设与两组 Violet 强调色，默认改为 Dark Violet；`index.css` 的回退值改为同一套；`GraphView`、`ContainerNode` 里写死的金色强调改为跟随强调色

## 2. 浏览页的差异覆盖层

- [x] 2.1 读 `diff-overlay.json` 时带上可选的 `label`、`description`，Diff 开关显示与提示它们
- [x] 2.2 `utils/diffLayerCounts.ts` 按 D5 计每层的 changed / affected，层卡片显示计数、没有差异的层变暗；分组高亮按同一规则并在首次显示时生效；单测含删掉路径归属后变红的确认

## 3. 打包读 `diff-overlay.json`

- [x] 3.1 `skills/excavator-view/explorer-data.mjs` 按「差异覆盖层」的规则读、校验并放进页面数据，打包结果写出状态与原因；`explorer-pack.test.mjs` 覆盖五个场景（先在旧代码上红）

## 4. 报告页外观

- [x] 4.1 `packages/prd-report-page`：样式改为浏览页的字体、颜色与卡片；Dark Violet / Light Violet 开关与本地存储；首次绘制前的内联脚本；mermaid 主题随开关；单测

## 5. 验证与提交

- [x] 5.1 只跑受影响的范围：两个包的 build、test、typecheck，`tests/skill/excavator-view`、`tests/skill/excavator-prd-report` 与读这两个包的根测试，`openspec validate --all --strict`；新文件先 `git add -N`
- [x] 5.2 真实语料：按 design 的 Oracle 用新代码 `--out` 重打浏览页并对比数据块；两页在 headless Chrome 里无控制台错误
- [x] 5.3 分阶段 commit（OpenSpec、浏览页的主题与差异覆盖层（两者都改 `GraphView.tsx`，合为一个）、打包、报告页），每个 commit 核对 `--stat`；PR 用 `--merge`，评审按 REVIEW.md
