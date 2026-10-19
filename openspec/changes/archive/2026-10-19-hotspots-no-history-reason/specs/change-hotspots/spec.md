## MODIFIED Requirements

### Requirement: 没有历史要看得见

没有历史或历史不完整时，计数 MUST NOT 报成 0，而 SHALL 进入看得见的分类：
- **没有历史的项目**：头部写明没有历史及其原因（见下）；每个文件的 `commits`、`authors`、`added`、`removed`、`lastChanged`、`score` 为 `null`，`lines` 照常统计。
- **浅克隆**：头部对该仓写明是浅克隆、边界提交数（`.git/shallow` 列出的提交，它们一律不计入），以及最早可见提交的时间（不受窗口限制）。该仓文件的计数照常给出，值是下限。skill 与 chat SHALL 说明该仓的计数只是下限。
- **多仓父目录**：每个成员仓单独读。不属于任何成员仓的文件，历史字段为 `null`。
- **二进制文件**（HEAD 内容的前 8000 字节含 NUL）：`lines` 与 `score` 为 `null`，提交数与作者数照常统计。
- 历史中任何一次改动被 git 判为二进制时（包括 HEAD 的属性文件标成不做文本比较的），该文件的 `added` 与 `removed` 为 `null`。

没有历史的原因 SHALL 是下面两种之一：
- `not-a-repository`：项目根不在任何 Git 工作区里，也没有哪个直接子目录是带提交的 Git 仓库；
- `inside-repository`：项目根在一个 Git 工作区里，但不是它的根。头部 SHALL 同时给出工作区根相对项目根的路径，以及项目根在工作区里的路径。

有 `.git` 却读不到历史时，脚本 SHALL 以非零状态退出、不写产物，并在消息里指出是哪个 `.git`、为什么读不到：
- 运行不了 `git`，而项目根、它的任一上级目录或任一直接子目录里有 `.git`；
- `git` 能运行，但不认项目根或某个直接子目录里的 `.git`。

直接子目录是还没有提交的 Git 仓库时，它照旧不算成员仓，不触发拒绝。

头部 SHALL 记有历史的文件数（属于一个读得到历史的仓，含浅克隆）、没有历史的文件数与二进制文件数。

#### Scenario: 非 Git 目录
- **WHEN** 对一个不在任何 Git 工作区里、也不含成员仓的目录运行
- **THEN** 产物头部写明没有历史，原因是 `not-a-repository`；所有文件的 `commits` 与 `score` 为 `null`，`lines` 有值

#### Scenario: Git 仓库的子目录
- **WHEN** 对一个 Git 仓库里的子目录 `apps/web` 运行
- **THEN** 产物头部写明没有历史，原因是 `inside-repository`，工作区根是 `../..`，项目根在工作区里的路径是 `apps/web`；所有文件的 `commits` 为 `null`，`lines` 有值

#### Scenario: 运行不了 git
- **WHEN** 环境里找不到 `git`，分别对一个 Git 仓库的根、它的子目录、以及含成员仓的父目录运行
- **THEN** 三次都以非零状态退出，不写产物，消息指出找到的 `.git` 与运行不了 `git`

#### Scenario: git 不认的 .git
- **WHEN** 项目根的 `.git` 是一个指向不存在目录的文件
- **THEN** 脚本以非零状态退出，不写产物，消息指出这个 `.git` 与 git 的报错

#### Scenario: 没有提交的子仓
- **WHEN** 一个普通目录下唯一的子仓还没有提交
- **THEN** 产物照常写出，没有历史，原因是 `not-a-repository`

#### Scenario: 浅克隆
- **WHEN** 对一个有 3 次提交的仓库做 `--depth 2` 克隆后运行，最新一次提交只改了文件 `f`
- **THEN** 头部标出浅克隆、1 个未计入的边界提交与最早可见提交的时间；`f` 的提交数是 1，其它文件是 0；skill 的汇报说明计数只是下限

#### Scenario: 多仓父目录里的非成员文件
- **WHEN** 父目录下有两个成员仓和一个不属于任何成员仓的文件
- **THEN** 两个成员仓的文件各按自己的历史计数，路径带成员目录前缀；非成员文件的历史字段为 `null`

#### Scenario: 二进制文件
- **WHEN** 一个 PNG 文件有 3 次提交
- **THEN** 它的 `commits` 是 3，`lines` 与 `score` 为 `null`，它不排在任何有分的文件之前

### Requirement: 产物、新鲜度与查询

脚本 SHALL 写 `.excavator/hotspots.json`。

头部 SHALL 包括：
- 源码快照的 revision；
- 每个仓的路径、HEAD、是否浅克隆、未计入的边界提交数与最早可见提交的时间；
- 没有历史时的原因，有历史时为空；原因是 `inside-repository` 时，还有工作区根相对项目根的路径与项目根在工作区里的路径；
- 窗口；
- 各分类的计数；
- 残余假设：
  - 合并提交不计；
  - 改名靠 git 的相似度判断，改动很大的改名会被当成一次删除加一次新建；
  - 复制不追；
  - 历史按 git log 的默认顺序沿单一路径映射归属；在分支历史与子树导入里可能漏掉部分改动，`lineageConflicts` 大于 0 的文件就是遇到这种情况的；
  - 作者按邮箱区分，同一个人用了多个邮箱又没有 mailmap 时，算作多人；
  - 行数包括空行与注释；
  - 历史被改写过（压缩、变基、从别的系统导入）时，此前的改动看不见；
  - 仓库本地的 `.git/config` 与 `.git/info/attributes` 仍会影响改名检测与二进制判定。

`/excavator-hotspots` skill 的汇报 SHALL：
- 列出排名靠前的文件与目录、头部计数，并逐条列出残余假设；
- 没有历史或是浅克隆时，在开头就说明；
- 没有历史时按原因说明。原因是 `inside-repository` 时，说明历史只在仓库根上读，在仓库根上运行后可以按目录查到这个子目录的数字，MUST NOT 说项目不是 Git 仓库；
- 只陈述产物里的数字，MUST NOT 给出重构、删除、拆分之类的建议。

`excavator-chat` 回答改动历史类问题时 SHALL 只读这个产物：
- 先用共享的新鲜度助手取当前 revision，与产物里的比对；不一致时说明产物已过期；
- 产物缺失时，建议先运行 `/excavator-hotspots`；
- 浅克隆的仓，说明计数只是下限；
- 没有历史时按原因说明，与 skill 的说法一致；
- MUST NOT 从事实图推断改动历史。

本能力只运行只读的 git 命令，MUST NOT 修改项目代码或 Git 状态。

#### Scenario: HEAD 变了
- **WHEN** 产物写出后有了新的提交
- **THEN** chat 回答时说明产物已过期，需要重新运行

#### Scenario: 产物缺失
- **WHEN** 用户问哪些文件改得最多，而项目没有 `.excavator/hotspots.json`
- **THEN** chat 建议先运行 `/excavator-hotspots`，不从事实图回答

#### Scenario: 在仓库子目录上汇报
- **WHEN** 在一个 Git 仓库的子目录上运行 `/excavator-hotspots`
- **THEN** 汇报开头说明项目根是仓库的子目录、历史要在仓库根上读，并给出这个子目录在仓库里的路径；不说项目不是 Git 仓库
