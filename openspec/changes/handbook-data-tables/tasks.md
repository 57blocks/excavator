## 1. 抽取（脚本）

提交：`feat(product-handbook): a data command that lists tables, migrations and where each name appears`

- [x] 1.1 夹具 `tests/fixtures/product-handbook/data-project/`（design O1）与手写期望的测试，先红
- [x] 1.2 迁移识别、拆 `up`、操作识别与重放（design D2）
- [x] 1.3 模型声明与常量解析（design D3）
- [x] 1.4 表名查找规则 a、b，一次遍历（design D4、D6）
- [x] 1.5 `data.json` 的写出与形状校验，`handbook.mjs data` 命令（design D5），守恒测试

## 2. 第三个部分

提交：`feat(product-handbook): data is a section of its own`

- [x] 2.1 `lib/sections.mjs` 加 `data`，错误提示列三个值；`sections` 测试（design O2）
- [x] 2.2 `sections/data.md`（Phase 4b）；`SKILL.md` 的选项、Sections 一节提到 `data`；合约测试钉摘要，其余三个文件摘要不变

## 3. 呈现

提交：`feat(product-handbook): the technical view shows the data section`

- [ ] 3.1 `ui-strings.json` 新键；`assemble` 读 `data.json`，技术手册加数据一章，缺失或不合格时一行说明（design D5）
- [ ] 3.2 页面数据 `/6`、`#/data` 路由、侧栏链接、数据页组件；产品视图不出现
- [ ] 3.3 渲染测试（design O3）

## 4. 验收

提交：`docs(openspec): record handbook-data-tables acceptance`

- [ ] 4.1 变异检查（design O1 四条），结果写进 `acceptance.md`
- [ ] 4.2 O4 真实运行与分层抽查，没过的线照实写
- [ ] 4.3 受影响测试、`check-refs`、`openspec validate --all --strict` 本地过；全量门在分离检出里跑（O5）
