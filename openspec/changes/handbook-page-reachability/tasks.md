提交序列（每组一个 commit，合并用 `--merge`，不 squash）：
1. `docs(openspec): propose handbook-page-reachability`
2. `feat(handbook-page): feature names in the text link to their pages`
3. `feat(handbook): the technical home page shows the system architecture`
4. `feat(handbook-page): grouped references, a named system overview and reading across domains`
5. `docs(openspec): acceptance of handbook-page-reachability`

## 1. 正文里的功能链接

- [x] 1.1 先写红测试：
  - 标题在前的 ASCII 与全角括号两种写法；
  - 只链接编号的写法；
  - 页面没有的编号；
  - 代码、链接、标题与 mermaid 里的编号；
  - 本页自己的编号；
  - 表格单元格里的编号；
  - 小节编号 `h-<n>` 与图的 id 不变。
- [x] 1.2 实现 remark 插件并接到 `Markdown`。
  - **验证：** 1.1 全绿；页面包现有测试全绿。

## 2. 技术视图首页的系统架构与图的全屏查看

- [x] 2.1 页面数据 `/21` 的 `architecture`，先写红测试：
  - 第一张图所在的二级小节；
  - 第一张图在第一个二级标题之前；
  - 没有图；
  - 没有系统章节；
  - 两种视图的引文；
  - 同一输入两次输出相同。
- [x] 2.2 首页的「系统架构」一节（只在技术视图）与系统章节各小节的链接；图的全屏查看。
  - **验证：** 组件测试覆盖：产品视图没有这一节、技术视图有、小节链接打开系统章节并停在那一节、全屏的打开与 Esc 关闭和焦点归还。

## 3. 导航

- [x] 3.1 参考资料按目录的部分分组：顶栏下拉、手机菜单、左栏、首页。
- [x] 3.2 系统章节在导航里叫「系统总览」。
- [x] 3.3 功能页的上一页与下一页跨业务域，跨域时标出目标所在的域。
  - **验证：** 组件与纯函数测试覆盖 3.1 到 3.3；`page-browser.test.mjs` 通过。

## 4. 验收

- [x] 4.1 在验收用的真实输出副本上重新生成页面：
  - 用脚本统计每个业务域页上能点到的本域功能数，应为全部；
  - 截图核对技术视图首页的架构一节、图的全屏、参考资料分组、跨域的下一页，桌面与手机、浅色与深色。
- [x] 4.2 结果写进 `acceptance.md`。
