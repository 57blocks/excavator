## 1. 领域文件与检查（脚本）

提交：`feat(product-handbook): business domains as a checked layer over the map`

- [x] 1.1 `domains.json` 的形状、`check-domains` 命令（守恒、编号、空领域、读者文字与叙述语言、领域名引文）
- [x] 1.2 续跑：通过检查则保留；地图换了而对不上时报出
- [x] 1.3 夹具测试（design O1 的 `check-domains` 与续跑各条）

## 2. 实体与输出取领域

提交：`feat(product-handbook): the views group features by business domain`

- [ ] 2.1 实体、关系与矩阵里的领域取 `domains.json`，没有或不通过时退回区域，并写固定文字说明
- [ ] 2.2 `handbook.md`、`handbook-technical.md` 与页面数据按领域；页面包的导航与领域页取领域
- [ ] 2.3 测试（design O1 的实体各条）

## 3. SKILL.md 与合约测试

提交：`docs(product-handbook): the skill groups the map's features into business domains`

- [ ] 3.1 第 3c 阶段：提示词（D4）、`check-domains`、两次尝试、续跑；地图提示词保持与 main 相同
- [ ] 3.2 合约测试（O2）

## 4. 验收

- [ ] 4.1 变异检查（design O1 三条），结果写进 `acceptance.md`
- [ ] 4.2 O3 真实运行与独立审读，结果写进 `acceptance.md`，没过的线照实写
- [ ] 4.3 受影响测试、`check-refs`、`openspec validate --all --strict` 本地通过；全量门在分离检出里跑（O4）
