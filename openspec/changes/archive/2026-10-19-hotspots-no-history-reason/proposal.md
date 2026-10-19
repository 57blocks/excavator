## Why

产物头部只用 `historyAvailable: false` 表示没有历史，skill 与 chat 一律把它说成「项目不是 Git 仓库」。实测有两种情况这句话是错的：
- 项目根是某个 Git 仓库的子目录：脚本按普通目录处理，报没有历史；其实历史在，在仓库根上运行就能按目录查到这个子目录的计数。
- 环境里运行不了 `git`：一个真实仓库被当成普通目录，1,103 个文件全部没有历史，脚本照常退出，不报错。

第二种是把「读不到」报成「没有」，违背「没有历史要看得见」的本意。

## What Changes

- 头部新增 `noHistory`。有历史时为 `null`；没有历史时写明原因：
  - `not-a-repository`：项目根不在任何 Git 工作区里，也没有带提交的成员仓；
  - `inside-repository`：项目根是某个 Git 仓库的子目录，同时给出仓库根相对项目根的路径。
- 有 `.git` 却读不到历史时，脚本以非零状态退出，不写产物，并说明原因：
  - 运行不了 `git`，而项目根、它的上级目录或直接子目录里有 `.git`；
  - `git` 能运行，但读不了项目根或某个直接子目录里的 `.git`，例如它已损坏。
- `/excavator-hotspots` 与 `excavator-chat` 按原因说明没有历史。子目录的情况，说明在仓库根上运行可以按目录查到这个子目录的数字。
- 不做：
  - 不支持直接在子目录上读历史。在仓库根上运行已经能按目录给出这个子目录的数字；直接支持要改共享的源码快照，改动会扩散到其它能力。
  - 不改共享的源码快照与成员仓发现。其它能力在运行不了 `git` 时同样会当成普通目录，不在本次范围。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `change-hotspots`：「没有历史要看得见」加上没有历史的原因，以及读不到历史时的拒绝；「产物、新鲜度与查询」的头部加上 `noHistory`，skill 与 chat 按原因说明。

## Impact

- 脚本：`skills/excavator/hotspots.mjs`，新增 `skills/excavator/hotspots/no-history.mjs`。
- skill：`skills/excavator-hotspots/SKILL.md`、`skills/excavator-chat/SKILL.md`。
- 测试：`tests/skill/excavator/test_hotspots.test.mjs`、`tests/skill/test_hotspots_skill_contract.test.mjs`。
- 产物格式仍是 `excavator-hotspots/1`，只加字段。
