## Context

源码快照判定顺序是「仓库根 → 有成员仓的父目录 → 普通目录」。判成普通目录时，热点脚本只知道 `historyAvailable: false`，不知道为什么。快照是多个能力共用的，本次不动它。

## Goals / Non-Goals

**Goals:**
- 没有历史时，头部写明原因；有 `.git` 却读不到时，拒绝写产物。
- skill 与 chat 按原因说，不再一律说「不是 Git 仓库」。

**Non-Goals:**
- 不在子目录上直接读历史。
- 不改共享快照与成员仓发现，也不改其它能力在运行不了 `git` 时的行为。

## Decisions

**1. 只在快照判成普通目录之后解释原因。** 快照判成仓库或多仓时，历史照常读，`noHistory` 为 `null`。解释放在热点脚本自己的模块里，不改快照。代价：其它能力在运行不了 `git` 时，仍会把仓库当普通目录。

**2. 按结构判定，不匹配 git 的报错文字。** git 的报错会随语言环境本地化。判定只看三件事：能不能启动 `git`、`git rev-parse --show-toplevel` 是否成功、哪里有 `.git`。

| 情况 | 结果 |
|---|---|
| `rev-parse` 在项目根成功 | `inside-repository`，给出 `repositoryRoot`（工作区根相对项目根，如 `../..`）与 `pathInRepository`（如 `apps/web`）。工作区根恰好等于项目根说明和快照判定矛盾，报错退出 |
| 启动不了 `git`，项目根、任一上级目录或任一直接子目录有 `.git` | 拒绝，消息列出找到的 `.git` 与启动失败的原因 |
| 启动不了 `git`，以上位置都没有 `.git` | `not-a-repository` |
| `git` 能运行，`rev-parse` 失败，项目根有 `.git` | 拒绝，附 git 报错的第一行 |
| `git` 能运行，某个直接子目录有 `.git`，但它不是 git 认的仓库根 | 拒绝，附该子目录上 git 报错的第一行 |
| 其余（含只有没提交的子仓） | `not-a-repository` |

`git` 能运行时只信 git 对上级目录的判断，不再自己找上级目录里的 `.git`。用户主目录里残留的空 `.git` 之类，git 不认，也不该让每个项目都被拒绝。

探测用和快照判定一样的环境（不屏蔽用户的 git 配置）。用户的 `safe.directory` 之类设置会照样生效，两边的判定保持一致。

**3. 头部字段形状固定。** `noHistory` 为 `null`，或 `{ reason, repositoryRoot, pathInRepository }`；`not-a-repository` 时后两项为 `null`。路径都是相对路径，产物里不出现机器上的绝对路径。格式版本不变，只加字段。

**4. 子目录的数字靠仓库根的目录行。** skill 告诉用户在 `repositoryRoot` 上运行，再按 `pathInRepository` 查目录行。路径由脚本给出，不让模型自己拼。

## Oracle

- 单测覆盖规格里的每个场景，包括三种「运行不了 git」（仓库根、子目录、多仓父目录）和一个指向不存在目录的 `.git` 文件。
- 真实语料（scratchpad 里的 APFS 克隆，只读 git）：
  - 对仓库里两级深的子目录运行，得到 `inside-repository`、`../..` 与正确的 `pathInRepository`；文件数等于 HEAD 在该子目录下的文件数；
  - `PATH` 里没有 `git` 时，分别对仓库根和子目录运行，都以非零状态退出，不写产物；
  - 在仓库根上运行，产物与本次改动前的产物相比，只多了 `noHistory: null`。
- 一次真实模型运行（headless，Sonnet）：在子目录上跑 `/excavator-hotspots`，汇报开头说明是仓库子目录并给出 `pathInRepository`，不说「不是 Git 仓库」。

## 验收记录（2026-10-19）

- **单测**：`test_hotspots.test.mjs` 70 个通过，其中新增 5 个；契约测试 19 个通过，其中新增 1 个。
- **全量门**：
  - build、typecheck 通过；
  - `vitest run`：147 个文件，3967 个测试通过，4 个跳过；
  - `pnpm lint` 失败，原因是仓库里没有 `eslint.config.*`。main 上同样如此，与本次无关。
- **真实语料**：dataverse 的 APFS 克隆，HEAD `cc6e62e335`。
  - **仓库根**：本分支的产物比 main 的只多了 `noHistory: null`，其余逐字段相同，共 2,992 个文件。
  - **子目录 `src/main`**：
    - 头部是 `inside-repository`，`repositoryRoot` 为 `../..`，`pathInRepository` 为 `src/main`；
    - 1,325 个文件，历史字段全为 `null`；文件集合与仓库根产物里 `src/main/` 下的行相同；
    - HEAD 在 `src/main` 下有 1,369 个文件。差的 44 个（png 17 个、svg 5 个，其余是字体与压缩过的 css 等）在两次运行里都被默认忽略规则排除。
    - Oracle 写的「文件数等于 HEAD 在该子目录下的文件数」不准确：实际成立的是两次运行选中的文件相同。
  - **`PATH` 里没有 git**：
    - 本分支：仓库根与 `src/main` 都以 1 退出，没有写产物；消息分别指出 `.git` 与 `../../.git`。
    - main 的脚本：同一输入下以 0 退出，写出的产物里 2,992 个文件全部没有历史。
- **真实模型运行**：一次，Sonnet，headless，7 轮，$0.19。
  - 在 `src/main` 上跑 `/excavator-hotspots`。
  - 汇报开头写明：
    - 原因是 `inside-repository`；
    - 仓库根是 `../..`；
    - 在仓库根上运行后，目录行 `src/main` 给出这个目录的数字。
  - 没有说项目不是 Git 仓库。advice check 0 行。
  - 只跑了一次，措辞的方差没有测。chat 的措辞与 skill 相同，由契约测试钉住，没有单独做真实运行。
