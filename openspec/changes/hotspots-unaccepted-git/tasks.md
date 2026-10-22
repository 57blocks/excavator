执行约束：
- 代码、注释、测试与 skill 散文用英文，零中文字符；不出现任何语料名。
- 测试只用临时目录里搭的布局；子进程环境关掉用户与系统 git 配置。
- 验收 oracle 见 design.md，动手前已写死。

提交序列（一个逻辑步一个 commit，PR 以 merge commit 合入）：

1. `docs(openspec): propose hotspots-unaccepted-git`
2. `fix(hotspots): check every .git at the root and below it, also inside another repository or a multi-repo parent`：任务 1.1–1.3。
3. `fix(hotspots): refuse when git starts but does not work, instead of blaming a .git`：任务 2.1–2.3。
4. `docs(openspec): record hotspots-unaccepted-git acceptance and archive`：任务 3.1–3.3。

## 1. 根与直接子目录的 .git（design D2、D3）

- [ ] 1.1 先写 T1、T2（design D5），确认在 main 的脚本上红。
- [ ] 1.2 `no-history.mjs`：导出检查项目根与每个带 `.git` 的直接子目录的函数，`explainNoHistory` 在判原因之前调用它；消息按 D4。
- [ ] 1.3 `hotspots.mjs`：快照判成 `multi-repo` 时，在读历史之前调用同一个检查；更新两个文件头部的说明。

## 2. git 不能工作（design D1、D4）

- [ ] 2.1 先写 T3、T4，确认 T3 在第 1 步的脚本上红。
- [ ] 2.2 `no-history.mjs`：用 `git --git-dir=/dev/null config --list` 判断 git 能不能工作；启动失败与非零退出都走「运行不了」的分支，消息按 D4。
- [ ] 2.3 `skills/excavator-hotspots/SKILL.md` 第 1 步：「历史存在但读不到」的消息加上 git 不能工作。

## 3. 验收与归档

- [ ] 3.1 O1：逐个做变异，记录哪个测试变红，做完还原。
- [ ] 3.2 O2–O4：真实语料对比、全量门、Linux 差异。
- [ ] 3.3 验收记录写进 design.md，同步主规格并归档。
