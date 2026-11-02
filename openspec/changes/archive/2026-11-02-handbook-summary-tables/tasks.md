## 1. 提案（提交 1）

- [x] 1.1 proposal、design（含 oracle O1–O3）、spec、tasks；`openspec validate --all --strict`

## 2. 汇总模块（提交 2）

- [x] 2.1 `skills/excavator-product-handbook/lib/summary.mjs`：按 D1–D5 输出 `{ notifications, jobs, counts }`；时间表取法按 D2，「做什么」按 D3（只认覆盖注册行的引文，不放宽）
- [x] 2.2 `tests/skill/excavator-product-handbook/` 下的汇总单测：O1 的时间表三个桶、守恒、「做什么」、只收 `verified`；先看到红再看到绿

## 3. Markdown 与固定文字（提交 3）

- [x] 3.1 `ui-strings.json` 加新键（英文）；`render.mjs` 在功能章节之后、覆盖一节之前写两张表与表前的计数句、固定说明
- [x] 3.2 测试：`handbook.md` 含两张表、两次拼装逐字节相同、无绝对路径与引文路径、缺键的 `ui.json` 被拒绝
- [x] 3.3 确认续跑时缺键的 `ui.json` 会被重新翻译（D7）；若不会，在 SKILL.md 的续跑说明里写明做法

## 4. 页面（提交 4）

- [x] 4.1 `page-data.mjs` 加 `summary`，格式升到 `excavator-product-handbook-page/2`；`packages/product-handbook-page` 加两个页面、导航项与类型；重新构建内嵌页面
- [x] 4.2 浏览器测试：两个新页面可到达、行数与数据一致、375 宽不横向滚动、无网络请求、无控制台错误；两次 `page` 逐字节相同

## 5. 文档（提交 5）

- [x] 5.1 SKILL.md 的拼装与页面两步各加一句：手册含两张横切总表，由脚本生成；合约测试相应断言
- [x] 5.2 O3：受影响测试、`check-refs`、`openspec validate --all --strict`；分离检出里跑全量三件套

## 6. 真实验收（提交 6）

- [x] 6.1 O2：在两份真实输出副本上用本分支插件续跑到拼装与页面，按 O2 逐项记录
- [x] 6.2 把 O1–O3 的结果写进 design 的验收记录（只写代号与脱敏摘要）
