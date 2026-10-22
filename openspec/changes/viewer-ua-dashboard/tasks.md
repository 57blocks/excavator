## Commit 序列

0. `docs(openspec): propose viewer-ua-dashboard`：本变更的文件，以及 viewer-learn 的暂停说明。
1. `feat(ua-view): copy the Understand Anything dashboard unchanged`（1.1）。
2. `feat(ua-view): read inlined data and run from one offline HTML`（1.2–1.3）。
3. `feat(view): pack the dashboard copy with the project's products`（2.1–2.2）。
4. `docs(openspec): record viewer-ua-dashboard acceptance and archive`（3.1–3.3）。

每个 commit 单独通过 O2。

## 1. 副本

- [ ] 1.1 原样复制 dashboard 源码与测试、`index.html` 与所引用的 core 模块，加 `LICENSE.understand-anything`、`UPSTREAM.md`、包配置与别名（design D1）；复制来的文件一字不改。验证：O2；`diff -r` 对上游目录只多出包配置三件。
- [ ] 1.2 离线改动（design D2）：数据与源码读内联对象、去掉令牌门、Worker 内联、`localStorage` 容错。验证：O1 读数据函数的键缺失分支先红后绿；副本自带测试全绿。
- [ ] 1.3 构建成一个 HTML 模板（design D3），模板开头的许可清单。验证：O3 离线冒烟（网络请求 0、控制台无错、有卡片）；模板体积记入验收。

## 2. 打包

- [ ] 2.1 `ua-data.mjs` 形状转换与 `ua-view.html` 写出（design D4），`validateGraph` 问题数。验证：O1 条数与内容不变、导览覆盖、缺产物缺键，各先红后绿；`view.html` 字节不变的测试。
- [ ] 2.2 回复多一行 `UA view:`，skill 契约测试同步。验证：单测。

## 3. 验收

- [ ] 3.1 O2 全量门。
- [ ] 3.2 O4 go-multirepo 逐项截图与 UA 开发服务器对照（design D5），O5 真实运行。
- [ ] 3.3 在 design.md 末尾写验收记录，同步主规范，归档本变更。
