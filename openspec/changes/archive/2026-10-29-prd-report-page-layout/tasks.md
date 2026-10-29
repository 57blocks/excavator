## 1. 纯函数与路由

- [x] 1.1 `lib/route.ts`：功能页多认 `finding` 参数（D5），往返与丢弃未知参数的单测
- [x] 1.2 `lib/nav.ts`：左栏按种类分组与筛选（D1）；`lib/jump.ts`：快速跳转的匹配与排序（D5）；`lib/matrix.ts`：功能矩阵与 findings 级别分组（D2、D4）；各自单测，并在旧实现或去掉规则时确认红

## 2. 外壳与各页

- [x] 2.1 外壳：顶栏、左栏导航、窄屏抽屉、本页目录（D1、D6），`Markdown` 给 h2/h3 确定的 id
- [x] 2.2 总览：概要四块与功能矩阵，正文与参考表顺序不变（D2）
- [x] 2.3 功能页：事实卡、findings 摘要条、findings、核对报告、翻页、`finding` 参数的滚动与高亮（D3、D5）
- [x] 2.4 findings 页：吸顶筛选条、级别按钮条数、按级别分组、卡片样式（D4）；覆盖页接入目录
- [x] 2.5 快速跳转对话框：按钮、Ctrl/⌘+K、`/`，键盘操作与焦点归还（D5）
- [x] 2.6 报告页主题改为 Theme 下拉菜单，默认 Light Violet，内联脚本与样式默认值同改，主题单测随之改（D8）
- [x] 2.7 浏览页默认预设改为 Light Violet 配 Violet，样式回退值同改，预设单测随之改（D8）

## 3. 验证与提交

- [x] 3.1 只跑受影响的范围：两个包的 build、test、typecheck，`tests/skill/excavator-prd-report` 与读这个包的根测试，`openspec validate --all --strict`；新文件先 `git add -N`
- [x] 3.2 真实语料：按 Oracle 用新模板重填 `report.html` 与 `explorer.html` 的原数据块并逐字节对比数据块；两种宽度、两种主题在 headless Chrome 里检查
- [x] 3.3 分阶段 commit（OpenSpec、报告页（纯函数与组件互相依赖，合为一个）、浏览页默认主题；两个包不共享文件，中间版本只差浏览页未改），每个 commit 核对 `--stat`；PR 用 `--merge`，评审按 REVIEW.md
