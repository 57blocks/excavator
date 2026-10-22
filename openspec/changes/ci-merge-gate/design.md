## Context

现状：
- 仓库唯一的工作流是运行镜像：PR 只有改到部署相关文件时才跑，测试那一步只跑三件套（安装、构建、全仓测试），不跑 core 测试、类型检查、引用检查与 OpenSpec 校验。
- `main` 没有分支保护；仓库公开，Actions 对公开仓库免费。
- 全量门只在 agent 本地（macOS）跑。运行镜像工作流最近一次在 Linux 上跑测试，151 个测试文件里 1 个失败：doc-map 的报错把证据路径截到 80 个字符，只在超过 80 个字符时才加「...」；测试却总是期望「...」。macOS 的临时目录路径超过 80 个字符，Linux 的 `/tmp` 不到，于是只在 Linux 上红。
- 隐私检查至今靠 agent 每次开 PR 前手动做：用两份不在仓库里的名单（私有名字是固定字符串，语料名是一条正则）扫改动的行、提交信息与 PR 正文。已归档的早期验收记录里有一个后来才列入私有名单的公开语料名，所以检查只能扫一个 PR 新带来的文字，不能扫整棵树。

GitHub 的几条机制决定了下面的取舍：
- 必过的检查如果因为路径过滤被跳过，算作通过；
- 手动触发（workflow_dispatch）只在工作流文件已经在默认分支上时可用；
- 从 fork 开的 PR 拿不到 secret；
- PR 的作者不能批准自己的 PR。

## Goals / Non-Goals

**Goals:**
- 每个进 `main` 的改动都走 PR，在 Linux 上过全量门；
- 隐私检查在 CI 里跑，名单不进仓库，名单不可用时失败；
- `main` 受保护，管理员也不能绕过。

**Non-Goals:**
- AI 审查、人工批准、风险分级、讨论必须解决：下一步；
- 合并队列；
- 扫描 `main` 已有的内容；
- 支持 fork PR 拿到 secret（不用 `pull_request_target`）；
- 取代本地按改动范围选检查的表：本地仍按表跑。

## Decisions

### D1 CI 每次跑全部检查，一个 job

job 名 `CI gate`，在 `pull_request`、推到 `main` 与手动触发时跑。步骤与 `AGENTS.md` 验证表的并集一致：
1. `pnpm install --frozen-lockfile`
2. `pnpm -r build`
3. `pnpm run typecheck`
4. `node scripts/check-refs.mjs`
5. `npx --yes @fission-ai/openspec@1.10.0 validate --all --strict`
6. `pnpm --filter @excavator/core test`
7. `pnpm test`

理由：
- 不按路径过滤：被跳过的必过检查算通过，过滤条件就是绕过口；合并需要的也正是并集。
- OpenSpec CLI 用 `npx` 钉版本：本地用的是全局安装的同一版本，它不是仓库依赖；为一次校验加依赖会改 lockfile。

代价：每个 PR 多等几分钟（运行镜像的测试 job 只跑三件套就要 5–6 分钟）。

其他设置：
- 只有 PR 的运行会被同一分支的新运行取消；推到 `main` 的运行不取消；
- 超时 45 分钟；
- 权限只读；
- action 钉提交 SHA，与运行镜像工作流用同一组。

### D2 隐私检查扫哪些文字

范围是 PR 的 base 到 head：
- **每个非合并提交新增的行**：历史是公开的，一行加了又在后面的提交删掉，仍然在仓库里；
- **整个 PR 相对合并基点新增的行**：合并提交解决冲突时写进的内容不出现在任何非合并提交里；分支要与 `main` 同步（D7）之后，从 `main` 合并进 PR 分支会是常事；
- **所有提交的提交信息**（含合并提交）；
- **每个提交改动的路径**；
- **PR 的标题与正文**。

不扫 `main` 已有的内容。

### D3 两份名单，两种范围

- **私有名字**：固定字符串，不分大小写；`pnpm-lock.yaml` 之外处处禁止。lockfile 里是随机的完整性哈希，短名字会偶然命中。
- **语料名**：每行一条正则，不分大小写；`openspec/`、`docs/` 与根目录 Markdown 之外禁止。验收记录写明在哪个语料上验过是证据。

提交信息与 PR 的标题、正文两份名单都扫，因为它们不是验收记录。

### D4 失败要关、输出要静

- 名单文件不存在，或去掉空行后为空，退出码 2，写明名单不可用。空行要先去掉：一条空的模式会匹配每一行。
- 正则写错也退出 2。
- 只打印「名单 × 来源」的命中行数，不打印命中的文字；有任何命中就退出 1。

### D5 脚本用 Node，不依赖任何包

`scripts/ci/privacy-scan.mjs`，写法跟 `scripts/check-refs.mjs` 一样：零依赖、不联网。

理由：
- 本地 macOS 与 CI 的 Linux 上正则语义相同（BSD 与 GNU grep 的方言不同）；
- 能用 vitest 测。

输入：base、head、两份名单文件，加上任意几个要扫的文本文件（PR 标题、正文）。

工作流里：
- secret 写到 `RUNNER_TEMP` 下的文件；
- PR 标题与正文经环境变量传入，不内插进脚本，以防注入；
- 手动触发时没有 PR，base 取 `origin/main` 与 HEAD 的合并基点。

### D6 触发与 fork

`Privacy scan` 在两种情况下跑：
- `pull_request` 的 opened、synchronize、reopened、edited，也就是改了标题或正文也重扫；
- 手动触发。

fork 的 PR 拿不到 secret，检查失败，由维护者在本仓库的分支上重开。不用 `pull_request_target`：它把 secret 交给处理不可信 PR 内容的运行，而目前没有来自 fork 的贡献。

### D7 分支保护与 secret

用经典的分支保护 API（`PUT /repos/{owner}/{repo}/branches/main/protection`）：
- 必过检查 `CI gate` 与 `Privacy scan`，`strict`（分支必须与 `main` 同步）；
- 必须走 PR，批准数为 0：批准在下一步；
- `enforce_admins` 为真；
- 禁止强推与删除。

不用合并队列：PR 数量少，`strict` 已经保证合并的是在最新 `main` 上验过的内容。

两个 secret：
- `PRIVACY_NAMES`：私有名单，外加一行金丝雀字符串；
- `PRIVACY_CORPUS`：语料正则，外加一行金丝雀。

金丝雀的字面不进仓库，只用于合并后的探针。今后名单以 secret 为准，加名字时两处一起改。

### D8 其余

- 运行镜像的测试 job 保留：镜像 job 依赖它。只改开头那句注释。
- doc-map 测试按脚本的规则写期望：路径超过 80 个字符才截断并加「...」。

## Oracles（动手前写死）

- **O1 装置**：vitest 在临时 git 仓库上用合成名单测脚本，名单里不放真实名字。逐条覆盖：
  - 每种来源都能检出：新增行、提交信息、路径、标题与正文；
  - 两种范围：语料名在 `openspec/`、`docs/` 与根目录 Markdown 里不计，在 `skills/` 下的 Markdown 与代码里计；私有名字处处计，lockfile 除外；
  - 加了又删的行；合并提交解决冲突时写进的行；
  - 名单缺失、全是空行、正则写错都退出 2；
  - 输出里没有命中的文字；
  - 干净的范围退出 0。

  另做变异：逐个关掉脚本的一种来源，确认有测试变红，做完还原。
- **O2 全量门**：本地全量门绿；PR 上的 `CI gate` 在 Linux 上绿，包括 doc-map 的修复。修复前在 Linux 上红，已由运行镜像的最近一次运行观察到。
- **O3 在真实环境里失败要关**：设置 secret 之前，这个 PR 的 `Privacy scan` 是红的，日志写明名单不可用；`gh secret set` 之后重跑变绿。
- **O4 合并后的探针**：在临时分支上手动触发：
  - (a) 一个失败的测试，`CI gate` 红；
  - (b) 私有名单的金丝雀写进 `docs/`，`Privacy scan` 红；
  - (c) 语料金丝雀写进 `docs/`，绿；
  - (d) 语料金丝雀写进代码文件，红；
  - (e) 私有名单的金丝雀只在提交信息里，红。

  日志里没有金丝雀的字面。探针分支事后删除。
- **O5 保护**：读回分支保护，与 D7 一致。下一个 PR（归档记录）在检查跑完前 `mergeable_state` 为 `blocked`，变绿后可合并。
- **O6 隐私**：本 PR 的改动行、提交信息、路径与正文，用本地名单做的手动检查全为 0。

## Risks / Trade-offs

- **Linux 上偶发的超时会挡住所有合并**：管理员也不能绕过。重跑即可；真要放开，由用户临时改保护。
- **名单有两份**（agent 本地与 secret）：以 secret 为准，加名字两处一起改。漏改本地那份不会放过任何东西，CI 会拦住。
- **每个 PR 多等几分钟**；`main` 前进后，其他 PR 都要先同步再重跑。
- **fork 的 PR 无法通过**：目前没有这类贡献，见 D6。
