## MODIFIED Requirements

### Requirement: HTML 导出

`page` SHALL 把地图、通过检查的条目、状态、算出的实体与关系和固定文字表写成 `handbook.html`。页面数据序列化后不超过 32 MB 时，`handbook.html` SHALL 是一个自含的文件；超过时，`page` SHALL 另写同级目录 `handbook-data/`，其中每个数据块文件 SHALL 不超过 8 MB，`handbook.html` 只内联导航与汇总页需要的核心数据，SHALL 在打开某一页时才加载那一页需要的块。写出过程 SHALL NOT 把整份数据变成一个字符串。每次运行 SHALL 先删除旧的 `handbook.html` 与 `handbook-data/`，运行失败时两者都不留下。

两种形态的页面 SHALL 双击即可从磁盘打开，不需要服务器、网络或安装任何东西，SHALL NOT 发起任何网络请求；数据块 SHALL 以 `<script>` 加载，SHALL NOT 用 `fetch`。一块加载失败时，页面 SHALL 写明缺少哪一块，其他页照常可用。超过 200 行的表格 SHALL 分页显示。页面 SHALL 有：所选视角的导航（产品视角按区域，技术视角按应用）、每个功能的页面、实体页、覆盖页，并且在手机宽度下没有横向滚动。选了两个视角时，顶栏 SHALL 有视角切换，切换后停在同一实体，另一视角没有这个实体时回到概览。页面上的固定文字 SHALL 全部来自固定文字表，页面的语言标签 SHALL 与 `--language` 一致。同样的输入 SHALL 得到同样的字节（含每个数据块），不含时间和本机路径；产品视角的正文与页面数据里产品部分不含引文路径。

#### Scenario: 从磁盘打开
- **WHEN** 在没有网络的机器上双击 `handbook.html`
- **THEN** 导航、功能页、实体页与覆盖页都能显示，没有网络请求，也没有控制台错误

#### Scenario: 中文页面
- **WHEN** 以 `--language Chinese` 运行并导出
- **THEN** 页面上的栏目名、表头与按钮都是中文，`<html lang>` 是中文的语言标签

#### Scenario: 小项目仍是一个文件
- **WHEN** 页面数据是 2 MB
- **THEN** 只写出 `handbook.html`，没有 `handbook-data/`

#### Scenario: 1 GB 的数据
- **WHEN** 页面数据约 1 GB
- **THEN** `page` 写出 `handbook.html` 与 `handbook-data/`，每块不超过 8 MB；双击打开后概览立即可用，打开一个功能页只加载它的块

#### Scenario: 缺一块
- **WHEN** `handbook-data/` 里的一个块被删掉后打开用到它的功能页
- **THEN** 该页写明缺少的块，其他页照常显示
