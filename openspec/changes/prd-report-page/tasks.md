## 1. 页面数据（提交 2）

- [ ] 1.1 `skills/excavator-prd-report/lib/page-data.mjs`：按 design D3 收集数据并检查一致
- [ ] 1.2 单测：夹具产物的完整对象；失败功能、缺章节、汇总过期、`findings.json` 缺失四种夹具
- [x] 1.3 跑 O1

## 2. 模板（提交 3）

- [ ] 2.1 `packages/prd-report-page`：vite 单文件构建、两个标记位、模板检查脚本，接入 `pnpm -r build`
- [ ] 2.2 页面：总览、功能页、findings 页、覆盖页、侧栏导航（design D4–D6）
- [ ] 2.3 单测：路由解析、findings 筛选、净化表；确认这些测试在 CI 里会跑（根目录 `pnpm test` 收得到，或 CI 调用了包的 `test` 脚本），写明是哪一种
- [x] 2.4 跑 O1

## 3. `prd.mjs page`（提交 4）

- [ ] 3.1 命令与 `lib/page.mjs`（或同类）：取数据、读模板、替换标记位、写 `report.html`（design D7）
- [ ] 3.2 测试：CLI、两次生成字节相同、模板未构建的报错、过期时不写
- [x] 3.3 跑 O1

## 4. skill 接线（提交 5）

- [ ] 4.1 `SKILL.md` 在 `assemble` 后运行 `page`；`reply.mjs` 打印报告页一行（design D8）
- [ ] 4.2 契约测试、`README.md`、`docs/deploy.md`
- [x] 4.3 跑 O1

## 5. 验收与归档

- [x] 5.1 跑 O2–O8，结果写进 design.md 的验收记录（提交 6）
- [ ] 5.2 归档变更（提交 7）
