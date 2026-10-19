## 1. 脚本说明没有历史的原因（commit：`feat(hotspots): say why a project has no history`）

- [x] 1.1 新增 `skills/excavator/hotspots/no-history.mjs`：按 design 决定 2 的表判定原因或拒绝
- [x] 1.2 `hotspots.mjs`：快照判成普通目录时调用它，头部加 `noHistory`；有历史时为 `null`
- [x] 1.3 单测：子目录、普通目录、三种运行不了 git、git 不认的 `.git` 文件、子目录 `.git` 不认、只有没提交的子仓；已有的普通目录测试断言 `noHistory`

## 2. skill 与 chat 按原因说明（commit：`fix(skill): explain missing history by its reason`）

- [x] 2.1 `skills/excavator-hotspots/SKILL.md` 第 2 步：按 `noHistory.reason` 分别说明；`inside-repository` 给出仓库根与 `pathInRepository`，以及在仓库根上运行后查哪一行
- [x] 2.2 `skills/excavator-chat/SKILL.md` 改动历史一节：同样按原因说明
- [x] 2.3 契约测试：钉住两处措辞不再一律说「不是 Git 仓库」，且字段名都在产物里

## 3. 验收与归档（commit：`docs(openspec): record hotspots-no-history-reason acceptance and archive`）

- [x] 3.1 真实语料：子目录、`PATH` 无 git、仓库根回归对比
- [x] 3.2 一次真实模型运行：子目录上的汇报
- [x] 3.3 验收记录写进 design.md，同步主规格并归档
