## Context

`hotspots/no-history.mjs` 在快照判成普通目录后解释没有历史的原因，或在有 `.git` 却读不到时拒绝。原来的判定顺序是：

1. 在项目根上跑 `git rev-parse --show-toplevel`；启动失败就在根、上级、直接子目录里找 `.git`；
2. 成功就立刻报 `inside-repository`；
3. 失败才看根和直接子目录的 `.git`。

第 2 步跳过了第 3 步的检查；第 1 步只把启动失败当成运行不了 git。`hotspots.mjs` 只在没有成员仓时调用它，多仓父目录从不检查。

## Goals / Non-Goals

**Goals:**
- `git` 不能工作时，不管它能不能启动，都按「运行不了」处理，消息不怪 `.git`。
- 项目根在别的工作区里、或是多仓父目录时，同样检查根与直接子目录的 `.git`。

**Non-Goals:**
- 仓库根不检查直接子目录。
- 不改共享快照与成员仓发现。
- 不处理环境变量 `GIT_DIR`、`GIT_WORK_TREE` 改变 git 判定的情况。

## Decisions

**D1. 先在没有仓库的地方读一次配置，判断 git 能不能工作。** 探测命令是 `git --git-dir=/dev/null config --list`，`cwd` 为项目根。
- 显式的 `--git-dir` 指向一个不是仓库的路径，git 不做仓库发现。项目根、上级目录或子目录里哪个 `.git` 坏了，都不会让探测失败。
- 它读的配置来源和别的命令一样：系统、用户，以及 `GIT_CONFIG_PARAMETERS`、`GIT_CONFIG_COUNT` 这类环境变量。

提案前实测（git 2.55，用户与系统配置关掉；「坏仓库子目录」指 `.git/config` 有一行坏的仓库的子目录）：

| 环境 | `--git-dir=/dev/null config --list` | `version` | 项目根里 `config --list` |
|---|---|---|---|
| 正常 | 0 | 0 | 0 |
| `GIT_CONFIG_PARAMETERS="'"` | 128 | **0** | 128 |
| 用户配置文件有一行坏的 | 128 | 128 | 128 |
| 用户配置文件不存在 | 0 | 0 | 0 |
| 在坏仓库的子目录里 | 0 | 0 | **128** |

- 不用 `git version`：`GIT_CONFIG_PARAMETERS` 格式错误时它照样成功，而仓库命令全部失败。
- 不在项目根上跑不带 `--git-dir` 的 `config --list`：它会发现仓库、读仓库自己的配置。上级仓库的配置坏了，就会被说成 git 不能工作。这和原设计「git 能工作时，上级目录里 git 不认的 `.git` 不让下面每个项目都被拒绝」相悖。

探测启动失败，或以非零状态退出，都走原来「运行不了 git」的分支：
- 在项目根、每个上级目录、每个直接子目录里找 `.git`，找到就拒绝；
- 都没有，就是 `not-a-repository`。

**D2. git 能工作时，先检查再判原因。** 检查的是项目根与每个带 `.git` 的直接子目录（直接子目录的找法与成员仓发现相同）。
- 「认」的判据与快照判仓库根相同：在那个目录上 `git rev-parse --show-toplevel` 成功，且给出的工作区根（取 realpath）就是那个目录。
- 不认就拒绝，消息附理由：
  - `rev-parse` 失败：git 报错的第一行；
  - `rev-parse` 成功但工作区根在别处（git 跳过了这个 `.git`）：写明 git 读到的工作区根，路径相对项目根。
- 还没有提交的子仓，`rev-parse` 给出的就是它自己，算认，照旧不拒绝。

全部认了之后，再在项目根上跑 `rev-parse`：
- 成功：报 `inside-repository`。工作区根恰好是项目根时，与快照判定矛盾，仍报错。
- 失败：`not-a-repository`。

**D3. 多仓父目录做同一个检查。** 快照判成 `multi-repo` 时，`hotspots.mjs` 在读任何历史之前调用 D2 的检查。成员仓都是 git 认的仓库根，自然通过。
- 不做 D1 的探测：能找到成员仓，git 就能工作。
- 快照判成 `git` 时不检查直接子目录。子目录里的嵌套仓库或子模块在根仓里只是一个 gitlink，它的历史本来就不在产物里。查它会让一个坏掉的子模块挡住整个仓库。

**D4. 消息。** 不匹配 git 的报错文字（会本地化），只把第一行原样带上。
- 启动不了（不变）：`git could not be started (<code>), so the history in <.git 列表> cannot be read`
- 不能工作（新）：`git does not work here (<探测报错第一行>), so the history in <.git 列表> cannot be read`
- 不认根（前缀不变）：`git does not accept .git in the project root, so its history cannot be read: <理由>`
- 不认子目录（前缀不变）：`git does not accept <子目录>/.git, so its history cannot be read: <理由>`
- git 跳过它时的理由：`git skips it and reads the work tree at <相对项目根的路径>`，路径为空时写 `.`。

`/excavator-hotspots` 第 1 步的说明从「git could not be started, or does not accept a `.git`」改为同时包括「does not work」。契约测试钉的那半句不变。

**D5. 测试。** 全部用临时目录里搭的布局，经子进程跑脚本。子进程环境关掉用户与系统配置（`GIT_CONFIG_GLOBAL`、`GIT_CONFIG_NOSYSTEM`），只断言脚本自己的消息片段。

| 测试 | 布局 | 不修时 |
|---|---|---|
| T1 | 仓库 `R` 的子目录做项目根：(a) 根里有缺了 `HEAD` 的 `.git` 目录；(b) 直接子目录 `m/.git` 是指向不存在目录的文件；(c) 直接子目录 `m/.git` 是缺了 `HEAD` 的目录。护栏：子目录下只有一个没提交的子仓，照常报 `inside-repository` | (a)(b)(c) 退出 0，报 `inside-repository` |
| T2 | 多仓父目录，有成员仓 `a`：(a) 另一个子目录 `m/.git` 指向不存在的目录；(b) 父目录自己有缺了 `HEAD` 的 `.git`。护栏：另有一个没提交的子仓，照常写出产物 | (a)(b) 退出 0，产物写出 |
| T3 | `GIT_CONFIG_PARAMETERS="'"` 与坏的用户配置文件各一遍，分别对仓库根、它的子目录、含成员仓的父目录运行；再加一个哪里都没有 `.git` 的目录 | 仓库根与父目录的消息说 git 不认 `.git`；子目录退出 0，报 `not-a-repository` |
| T4 | 仓库根的 `.git/config` 有一行坏的，用户配置完好 | 不修也绿：护栏，钉住探测不做仓库发现 |

## Oracle

动手前写死：

- **O1 每个修复都有测试守着。** 逐个做下面的变异，记录哪个测试变红，做完还原：
  - M1：把检查挪回「`rev-parse` 成功就报 `inside-repository`」之后，T1 红；
  - M2：去掉 `hotspots.mjs` 对多仓父目录的检查，T2 红；
  - M3：探测只把启动失败算作不能工作，T3 红；
  - M4：探测去掉 `--git-dir=/dev/null`，T4 红；
  - M5：把没提交的子仓也算作不认，T1 与 T2 的护栏红。
- **O2 不回归。**
  - 已有的 `test_hotspots.test.mjs` 测试全部照旧通过，不改它们的断言。
  - 真实语料只读，在 scratchpad 的 APFS 克隆上跑确定性脚本，不跑模型。本分支与 main 的产物逐字节相同：
    - 多仓父目录 go-multirepo；
    - 一个公开 Go 仓库的根与它的一个子目录。
- **O3 全量门。**
  - `pnpm install --frozen-lockfile && pnpm -r build && pnpm test`；
  - `node scripts/check-refs.mjs`（改了 `SKILL.md`）；
  - `openspec validate --all --strict`；
  - 新增源码与测试零中文字符，不出现语料名。
- **O4 Linux 差异。** 开 PR 前用短 `TMPDIR` 与 `user.useConfigOnly=true` 各跑一次 `test_hotspots.test.mjs`。以 CI 的 Linux 结果为准。

没有真实模型运行：skill 只改了一句里的一个分句，由契约测试钉住；拒绝时不写产物，模型看到的只是消息。
