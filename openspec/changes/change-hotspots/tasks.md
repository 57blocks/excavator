## Commit 序列

0. `docs(openspec): propose change-hotspots`：本变更的四个文件。
1. `feat(skill): count change hotspots from git history`：`skills/excavator/hotspots.mjs` 与它的单元测试（1.1–1.3）。
2. `feat(skill): excavator-hotspots and chat answers`：skill、chat 一节、README、安装测试与契约测试（2.1–2.3）。
3. `docs(openspec): record change-hotspots acceptance and archive`：验收记录、同步主规范、归档（3.1–3.4）。

## 1. 普查脚本

- [x] 1.1 `skills/excavator/hotspots.mjs <projectRoot> [--since YYYY-MM-DD]`：按 design D2–D5 读历史、沿谱系归属、统计文件与目录、打分、守恒，写 `.excavator/hotspots.json`。验证：在本仓库上运行，产物写出且守恒成立。
- [x] 1.2 单元测试 `tests/skill/excavator/test_hotspots.test.mjs`：脚本化 fixture 仓覆盖规范的每个 Scenario，包括浅克隆、多仓父目录、非 Git 目录与改名上限。验证：测试通过。
- [x] 1.3 O1 的 13 种注入变异逐一变红，记下结果。

## 2. skill 与 chat

- [x] 2.1 `skills/excavator-hotspots/SKILL.md`：
  - 跑脚本，用 `jq` 读头部与排名；
  - 没有历史或浅克隆时在开头说明；
  - 逐条列出残余假设；
  - 收尾自检：汇报里没有建议性措辞。
  验证：契约测试钉住这些规则。
- [x] 2.2 `skills/excavator-chat/SKILL.md` 加「改动历史类问题」一节：新鲜度比对、产物缺失、浅克隆说明、不从事实图推断。验证：契约测试钉住。
- [x] 2.3 `README.md` 加命令；`tests/install/install.test.mjs` 的 skill 数加一。验证：安装测试与 `check-refs` 通过。

## 3. 验收

- [ ] 3.1 O2 全量门：vitest、`check-refs`、`openspec validate --all --strict`。
- [ ] 3.2 O3 真实语料：sakai 与本仓库的独立比对、分层 `--follow` 核对、耗时与内存；hadoop、`_nongit`、openmrs-workspace 三种情况。
- [ ] 3.3 O4：dataverse 克隆上的 headless skill 运行与一次 chat 提问。
- [ ] 3.4 在 design.md 末尾写验收记录，同步主规范，归档本变更。
