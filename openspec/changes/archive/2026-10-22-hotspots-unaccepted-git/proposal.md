## Why

规格要求：有 `.git` 却读不到历史时，热点脚本拒绝写产物。其中一类是「`git` 能运行，但不认项目根或某个直接子目录里的 `.git`」。实测有三处没做到，两处把「读不到」报成了别的：

- **项目根在别的 Git 工作区里**：脚本只要在项目根上 `git rev-parse --show-toplevel` 成功，就立刻报 `inside-repository`，不再看根和直接子目录里的 `.git`。
  - 根里有一个 git 不认的 `.git` 目录（例如缺了 `HEAD`），git 跳过它，找到上级工作区。产物说项目根是上级仓库的子目录，根自己的那份历史没有提。
  - 直接子目录 `m/.git` 是指向不存在目录的文件，同样报 `inside-repository`，不拒绝。
- **多仓父目录**：只要找到一个成员仓，脚本就不再检查别的 `.git`。另一个直接子目录的 `.git` git 不认、或根里有 git 不认的 `.git` 时，产物照常写出，那个子目录的文件全部没有历史。
- **git 启动了却不能工作**：只有启动失败才算「运行不了 git」。用户级配置损坏时（例如 `GIT_CONFIG_PARAMETERS` 格式错误，或用户配置文件里有一行坏的），git 能启动，但每个命令都失败：
  - 对仓库的子目录运行，产物写出，原因是 `not-a-repository`；
  - 对仓库根运行，消息说 git 不认项目根的 `.git`。其实 git 什么都不认，`.git` 没有问题。

## What Changes

- 先判断 git 能不能工作：在不涉及任何仓库的地方读一次 git 自己的配置。启动不了或读失败，都按「运行不了 git」处理：在项目根、上级目录与直接子目录里找 `.git`，找到就拒绝，消息说 git 不能工作，不说 git 不认哪个 `.git`。
- git 能工作时，先检查项目根与每个带 `.git` 的直接子目录 git 认不认，再决定原因。不认的就拒绝，不管项目根是不是在别的工作区里。还没有提交的子仓是 git 认的仓库，照旧不拒绝。
- 多仓父目录做同样的检查（项目根与每个带 `.git` 的直接子目录）。
- `/excavator-hotspots` 第 1 步把「git 不能工作」加进「历史存在但读不到」的消息里。
- 不做：
  - 仓库根（快照判成 `git`）不检查直接子目录：子目录里的仓库不在根仓的历史里，坏掉的子模块不该挡住整个仓库。
  - 不改共享的源码快照与成员仓发现。
  - 环境变量 `GIT_DIR` 指向别处时快照本身就会判错，不在本次范围。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `change-hotspots`：「没有历史要看得见」里的拒绝条件写明三点：git 启动了却不能工作也算运行不了；项目根在别的工作区里时照样检查根与直接子目录的 `.git`；多仓父目录同样检查。新增对应场景。

## Impact

- 脚本：`skills/excavator/hotspots/no-history.mjs`、`skills/excavator/hotspots.mjs`。
- skill：`skills/excavator-hotspots/SKILL.md` 第 1 步一句。
- 测试：`tests/skill/excavator/test_hotspots.test.mjs`。
- 产物格式与字段不变；只是更多情况拒绝写产物。
