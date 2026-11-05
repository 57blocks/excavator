## 1. 视角、实体与关系（脚本）

提交：`feat(product-handbook): views, and entities and relations computed from verified units`

- [x] 1.1 `--views` 解析：默认 `product`，接受 `product,technical`（顺序无关、去重），拒绝其他取值并打印可选值；`assemble`、`page`、`reply` 都接受它
- [x] 1.2 实体与关系模块（纯函数，D2）：领域、功能、角色、应用（应用根目录与概览子应用）、定时任务、通知、外部集成；只取 `verified` 单元
- [x] 1.3 引文归属按目录最长匹配；领域与应用的引文数；角色 × 功能、应用 × 领域两张矩阵
- [x] 1.4 系统名的字面查找：每个应用根目录、与候选列表同一批源文件与跳过规则、区分大小写，记文件数；与「引文所示的调用方」分开存
- [x] 1.5 引文行范围：用引文核对的同一个定位函数算出，不另写一套
- [x] 1.6 夹具测试：design O1「实体与关系」各条，逐字节相同

## 2. 手册与页面数据按视角输出

提交：`feat(product-handbook): the handbook is written per view, with entity pages and matrices`

- [x] 2.1 `handbook.md`（产品）与 `handbook-technical.md`（技术），只写所选视角，删去没选视角的旧文件
- [x] 2.2 实体各节与两张矩阵；标题与说明只写检查了什么（D4），固定文字全部进 `ui-strings.json`
- [x] 2.3 技术视角每一项带文件与行范围；产品视角零引文路径（扫描全部字符串与所有引文 `file` 比对的测试）
- [x] 2.4 页面数据带视角与实体；格式串升一版；回复写出所写的手册文件
- [x] 2.5 不带 `--views` 时现有测试只因新增的实体节与矩阵而改，逐个说明

## 3. 页面包

提交：`feat(product-handbook-page): view switch, navigation by application and entity pages`

- [ ] 3.1 两个视角时顶栏有切换，路由带视角前缀，切换停在同一实体，另一视角没有时回概览；一个视角时没有切换
- [ ] 3.2 技术视角按应用导航（应用 → 领域 → 功能），功能页逐项显示引文位置
- [ ] 3.3 实体页（领域、角色、应用、外部集成、通知、定时任务）与矩阵页；手机宽度无横向滚动
- [ ] 3.4 页面测试：design O1「页面」各条

## 4. SKILL.md 与合约测试

提交：`docs(product-handbook): the skill takes --views and passes it to assemble, page and reply`

- [ ] 4.1 第 0 阶段解析 `--views`，第 7 阶段把 `$VIEWS` 交给 `assemble`、`page`、`reply`；参数说明与回复格式更新
- [ ] 4.2 合约测试（O2）

## 5. 验收

- [ ] 5.1 变异检查（design O1 五条），各至少一个测试变红，结果写进 `acceptance.md`
- [ ] 5.2 受影响测试、`check-refs`、`openspec validate --all --strict` 本地通过；全量门在分离检出里跑（O4）
- [ ] 5.3 O3：在 go-multirepo 现有输出上两个视角拼装与导出，零模型花费；线与只报告的内容写进 `acceptance.md`
