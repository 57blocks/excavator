## Context

- `excavator-prd-report`（规格 `prd-report`）由泳道各写一章，章节 front-matter 声明 `flows` 与 `openItems`；`assemble` 把各章的待确认项小节从正文搬出，`aggregate` 把它们按功能原样放进 `tables/open-items.md`，拼成 `## Open items`。
- 上一次真实运行（51 文件后端成员，Sonnet）的基线：
  - 8 个流程与自动类章节：引言 1.3 KB，流程小节 147 KB，待确认项 20 KB，其他 `###` 小节 21 个、44 KB（概述 8 个，权限或角色矩阵 7 个，字典 3 个，配置 3 个）；
  - 流程章节里表头或首列含两个以上权限角色名的表 5 张；
  - 10 章待确认项共 90 行，10 张表，列名与列数各不相同。
- 泳道提示词的深度要求有 `**Permissions** — a role-by-capability table for the feature`，与章节结构一段的「A flow chapter refers to a `reference` chapter by name instead of repeating it」矛盾。
- `excavator-verify --fix` 会改写已解决的待确认项的文字，不删行。

## Goals / Non-Goals

**Goals**
- 流程章节不再各写一遍角色矩阵、字典与共用设置。
- 同一个待确认问题在 `PRD.md` 里只出现一行，并标出哪些功能提过它；合并不丢事项、不写新文字。

**Non-Goals**
- 见 proposal 的「不做」。

## Decisions

### D1 为什么写代码（AI-first scope gate）

- 哪些待确认项是同一个问题是判断：由合并子代理做。
- 事项清单的抽取与编号、每条至多一组的守恒、清单是否变过、表的生成是全表事实：由脚本做。合并子代理只给出分组与保留哪一条，表里的文字全部来自章节原文，模型不转写。
- 章节的 `###` 小节是否都是流程，是声明与正文的一致性：脚本核对 `flows`、`openItems` 与标题。

### D2 流程章节只有流程

- `flow` 与 `automated` 章节：正文的每个 `###` 标题 SHALL 是 `flows` 里的一项或 `openItems`。否则 `check-lane` 打印 `<id>: ### "<title>" is neither a listed flow nor the open items heading; a flow chapter holds only its flows and its open items`。`reference` 章节不检查。
- 第一个 `###` 之前（`##` 之下）是章节引言：功能的流程图、概述、与其他功能的衔接。
- 泳道提示词：
  - 深度要求的权限一条改为：每个流程写哪些角色能发起、各自看到什么；角色 × 能力矩阵、字典表与多个流程共用的设置在 `reference` 章节，流程章节按名字引用它，不重复。
  - 章节结构一段写明本条规则与引言的用途。
  - `flows` 一段原有「概述、配置、权限、findings 小节不是流程」，保留：不能为了过检查把它们列成流程。
- 残余：泳道可能把矩阵挪进引言或某个流程的 `####` 里。O5 按表计数。

### D3 待确认项写成三列表

- `openItems` 小节 SHALL 只有一张三列表：事项、已知什么、搜过哪里（表头用 `$LANGUAGE`）。至少一行数据，除空行外没有别的内容。
- 否则 `check-lane` 打印 `<id>: the open items section is not one table of three columns (item, what is known, what was searched)`。

### D4 两条新检查只在泳道检查时做

- `laneResult` 增加一个选项：`check-lane` 做 D2、D3 的检查，`aggregate` 的重检不做。
- 原因：
  - 已有的 `/2` 产物目录里核对过的章节有概述、权限小节与各种待确认项格式。若 `aggregate` 重检，这些章节会被判 `failed`。
  - `--fix` 只改写待确认项的文字，不加 `###`。
- `index.json` 的格式不变。

### D5 事项清单与合并文件

- `lib/open-items.mjs` 从每个写成的章节（`WRITTEN_STATUSES`，按章节顺序）用 `splitChapter` 取待确认项小节，抽出事项：
  - 表的数据行：三格时依次是事项、已知、搜过；其他格数时事项是各格以 ` — ` 相连，另两项为空。
  - 没有表行时，取顶层列表项作为事项。
  - 两者都没有、小节非空时，整节是一条事项。
  - 每条的 id 为 `<功能 id>.<序号>`，序号从 1 起。
- `prd.mjs check-open-items <out> --project <root>`：
  - 把清单写到 `open-items/sources.json`：`{"digest": "<清单的 sha256>", "items": [{id, feature, item, known, searched}]}`，同一输入字节相同。
  - 核对 `open-items/merged.json`：`{"digest": "...", "groups": [{"keep": "<id>", "also": ["<id>", ...]}]}`。问题行：
    - 文件缺失、不可解析、形状不对、多余的键；
    - `digest` 与清单不同（`open-items/merged.json was written for other open items; merge them again`）；
    - 未知 id；
    - 一个 id 出现在两处；
    - `also` 为空；
    - `keep` 也在 `also` 里。
  - 最后一行：通过时为 `Open items: <n> written in the chapters, <m> after merging`；否则为 `Open items: <n> written in the chapters, not merged`。
  - 退出码：通过、或事项少于 2 条（无需合并，不要求文件）时退出 0，否则退出 1。
- `aggregate` 用同一校验生成 `tables/open-items.md`：
  - 一张表 `| # | Item | What is known | What was searched | Features |`；
  - 每组一行，内容取 `keep` 那条，放在组里最靠前那条的位置；
  - 组里其余各条的事项原文也写在这一行的 Item 格里，每条一行：`Also asked in <功能 id>: <事项>`，按清单顺序；
  - 不在组里的事项各一行；
  - Features 列为组内各条的功能 id，按章节顺序去重；
  - 合并不通过时每条各一行；没有事项时为 `None.`。
- 覆盖小节加一行，与 `check-open-items` 的最后一行相同。
- 被合并掉的事项在 `PRD.md` 里只显示事项本身；它们的已知与搜过留在各章节文件与 `sources.json` 里。合并错了也不会让一个问题从 `PRD.md` 里消失（见 D8）。

### D6 合并步骤（Phase 3）

- 位置：定级之后、写总览之前。
- 流程：
  1. 运行 `check-open-items`，退出 0 就跳过合并。
  2. 否则在前台派一个合并子代理。它只读 `sources.json`，只写 `merged.json`。
  3. 再跑 `check-open-items`。仍不过时删掉文件，带问题行再派一次。
  4. 第二次仍不过时删掉文件，待确认项不合并。这不算运行失败。
  5. 把最后一行告诉用户。
- 编排者 MUST NOT 写或改 `merged.json`。
- 合并提示词：
  - 同一组的事项问的是同一个问题，回答一条就回答了其余各条；只是主题相同、问的不同的，不分在一组。
  - 只是同样缺一份证据的（代码里都没找到、网关或部署都看不到），问的不是同一个问题。拿不准就不分组（D8）。
  - `keep` 选写得最全的那条（已知与搜过的内容最多）。
  - 原样抄 `digest`，不写自己的文字。
  - 只回一行 `Open items: merged`。
- 续跑：清单变了（章节重写或重新核对），`digest` 对不上，就重新合并。

### D7 提交顺序

1. `docs(openspec): propose prd-report-dedupe`
2. `feat(prd-report): keep flow chapters to their flows`：
   - `lane-check` 的 D2、D3 检查与只在泳道时做的选项（D4）；
   - 泳道提示词；
   - 单测与契约测试。
3. `feat(prd-report): merge duplicate open items`：
   - `lib/open-items.mjs`、`check-open-items`；
   - `aggregate` 的表与覆盖行；
   - 单测。
4. `feat(prd-report): dispatch the open items merge`：
   - `SKILL.md` 的 Phase 3 步骤与合并提示词；
   - 契约测试；
   - 根目录 `README.md`。
4a. `docs(openspec): keep merged open items visible in prd-report-dedupe`：D8 与相应的规格、任务。
4b. `feat(prd-report): list the merged items in their row`：`mergedRows` 与 `openItemsTable`、单测。
4c. `feat(prd-report): merge only items one answer settles`：合并提示词、契约测试。
4d. `docs(openspec): check each merged open item in prd-report-dedupe`：D9 与相应的规格、任务。
4e. `feat(prd-report): put back merged items the check rejects`：`checked.json` 的校验、`mergedRows`、覆盖行、`check-open-items`、单测。
4f. `feat(prd-report): dispatch the merge check`：Phase 3 第 5 步的核对子代理与提示词、文件表、契约测试。
5. `docs(openspec): record prd-report-dedupe acceptance`
6. `docs(openspec): archive prd-report-dedupe`

每个提交单独是绿的。

### D8 合并错了也不丢问题

在真实事项上的合并演练（上一次运行的 90 条事项，合并提示词一字不差）分了 12 组，独立审读判 2 组误合：一组把「名字是否唯一」与「匹配是否忽略大小写」合在一起，另一组把「登录失败是否限流」与「换取令牌失败是否限流」合在一起。两组的共同点都只是「代码里没找到、网关看不到」。

按 D5 原来的写法，被合并的那条在 `PRD.md` 里只剩功能 id，问题本身就看不见了。改两处：

- 合并行在 Item 格里列出组内其余各条的事项原文（D5）。合并错了，读者仍能看到每个问题，只是它们共用了保留那条的已知与搜过。
- 合并提示词加一条：只共享一份缺失证据的事项不是同一个问题；拿不准就不分组（D6）。漏合只多一行，误合会把一个问题放到另一个问题的答案下面。

代价：合并行变长，每条被合并的事项多一行事项文字；已知与搜过这两列，也就是最长的部分，仍只写一次。

### D9 合并之后逐条核对

D8 之后重做演练（同 90 条事项）：11 组，独立审读判 1 组误合（「登录失败是否限流」与「换取令牌失败是否限流」），还有 4 条部分相同。提示词再收紧也只是在边界上摇摆。合并行把保留那条的已知与搜过放在另一个问题旁边，读者会以为它回答了这两个问题，等于把文字安到了错的主体上。按本仓库别处的做法（doc-map、tour 的第二个子代理），加一道干净上下文的核对：

- 合并通过后，派一个核对子代理。它只读 `sources.json` 与 `merged.json`，对每组 `also` 里的每一条判断：回答了 `keep` 那条的问题，是否也就回答了这一条。拿不准判否。
- 它只写 `open-items/checked.json`：`{"digest": "<清单的 digest>", "members": [{"keep": "<id>", "id": "<id>", "same": true|false}]}`。`merged.json` 里每个 (`keep`, `also` 成员) 恰好一条，不多不少。
- 脚本校验：文件缺失或不可解析、形状不对、多余的键、`digest` 不同、少了或多了一对、一对出现两次、`same` 不是布尔值，各有一种问题行，都写出文件名 `open-items/checked.json`。
- `mergedRows`：合并与核对都通过时，`same` 为 false 的成员各自回到自己的一行（在清单里的原位置）；一组的成员全被退回时这一组不再存在。合并通过而核对不通过时，按没有合并处理。
- 覆盖行：通过时为 `Open items: <n> written in the chapters, <m> after merging`；核对退回了成员时后接 `; the check put back <k> of <j> merged items`。不通过时仍为 `..., not merged`。
- `check-open-items` 退出 0：事项少于 2 条；或合并通过、且没有 `also` 成员或核对通过。
- Phase 3 第 5 步：问题行写的是 `merged.json` 时派合并子代理（先删两个文件），只写 `checked.json` 时派核对子代理（先删它）；各重试一次。仍不过就删掉两个文件，待确认项不合并，不算运行失败。编排者 MUST NOT 写或改这两个文件。

代价：多一个只读清单的子代理，事项有重复时才派。核对子代理同样会出错，但它的错只会让事项少合并，不会多合。

## Risks / Trade-offs

- 流程章节的检查更严：标题多一个非流程小节就多一次泳道尝试。换来的是重复内容不再有固定的位置。
- 合并的误判：
  - 把两个不同的问题分进一组，另一条的事项仍列在这一行里，但它的已知与搜过只留在章节文件里（D8）。
  - O6 按组审读，误合即不通过。
- 漏合：没被分组的重复事项照旧各占一行，只是没有变短，不丢信息。
- 合并多一个子代理：只读清单，不读代码，花费小。合并不分批；事项上千条的项目一个子代理可能读不完，那时再分批，本变更不做。

## Acceptance oracles

动手前写死。真实语料的路径、名字与输出不进仓库，记录只写代号与数字。

- **O1 门**：每个代码提交在临时克隆（不用 worktree）里跑以下各项：
  - 三件套；
  - `node scripts/check-refs.mjs`；
  - `pnpm run typecheck`；
  - `openspec validate --all --strict`；
  - legacy-literals；
  - CI 模拟重跑（短 TMPDIR、`user.useConfigOnly=true`）。
- **O2 检查**：
  - D2、D3、D5 的每种问题行各一个测试，先红后绿；
  - 一个全部合格的正例；
  - `aggregate` 对一个有概述小节与两列待确认项、核对过的旧章节不判失败（D4）。
- **O3 合并**：夹具有三章，含跨章与同章的重复事项、一章用列表写待确认项、一章没有待确认项。
  - 合并通过时，表的行数等于事项数减各组 `also` 的条数，每行的文字等于 `keep` 那条的原文。
  - `merged.json` 缺失或 `digest` 过期时，每条各一行，覆盖行写 `not merged`。
  - 两次 `aggregate` 字节相同。
  - 变异以下任一处，测试必须变红：守恒（一个 id 放进两组）、`digest` 比较、保留行的位置。
- **O5 真实冒烟**：与上次相同的成员、模型与参数（`--fresh`，`--out` 在 scratchpad）。脚本核对：
  - 每个功能 `verified`，或 `failed` 且 `attempts` 为 2；
  - 流程与自动类章节里没有不是流程的 `###` 小节；
  - 流程与自动类章节里表头或首列含两个以上权限角色名的表不多于 1 张（基线 5）；
  - 每章待确认项是一张三列表；
  - `check-open-items` 最后退出 0；
  - `## Open items` 是一张表；
  - 语料 `.excavator/` 运行前后不变。
  - 记录：事项数与合并后的行数、`PRD.md` 的行数与字节（基线 3406 行、271 KB）、章节引言的字节、花费与耗时。
- **O6 独立审读（Sonnet）**：只拿到两份 PRD、`open-items/sources.json`、`merged.json` 与源码。
  - **硬性不通过**：
    - 单篇流程索引的某一行在拼装版没有覆盖它的流程行（`failed` 且 `attempts` 为 2 的功能范围除外）；
    - 某一组里有一条与 `keep` 问的不是同一个问题。
  - **照记**：合并后的表里仍成对重复的事项数；流程章节里是否仍重复 `reference` 章节的矩阵或字典。
- **O7 合并演练**（D8 之后加，D9 之后改为在核对之后判）：O5 的事项里没有重复时合并步骤没有被真正用到，所以在上一次运行的事项（含已知的跨章重复）上，用 `SKILL.md` 里一字不差的合并与核对提示词各派 Sonnet 子代理，`check-open-items` 退出 0。独立审读（Sonnet）对 `PRD.md` 里每个合并行逐条判断：
  - **硬性不通过**：任一合并行里有一条与保留那条问的不是同一个问题。
  - **照记**：部分相同的成员数；没分组的同问题对数；`PRD.md` 的合并行列出了组内每条事项。

## 验收记录

2026-10-27。实现由编码代理（Sonnet）按切片完成；门、真实运行与脚本核对由我完成；独立审读、合并演练里的合并与核对都派 Sonnet 子代理。克隆、产物与运行输出都在会话 scratchpad，不进仓库。输入代号：**夹具**（`tests/skill/excavator-prd-report` 里测试辅助函数造的运行目录）、**真实成员**（多仓库语料里 51 文件的后端成员，与上次 `prd-report-prd-shape` 的 O5 相同，`--scope` 指向它）、**基线**（上次 O5 在同一成员上的输出，章节是旧形状）。

### O1 门

每个代码提交在一份新的 `git clone --no-hardlinks` 里跑：`pnpm install --frozen-lockfile`、`pnpm -r build`、`pnpm test`、check-refs、typecheck、`openspec validate --all --strict`、legacy-literals、CI 模拟（短 TMPDIR、`user.useConfigOnly=true`）。

| 提交 | `pnpm test` | 其余 |
|---|---|---|
| 1818df3c 流程章节只有流程 | 5420 通过、4 跳过 | 全部 0 |
| 42fc6a6c 合并待确认项 | 5458 通过、4 跳过 | 全部 0 |
| 672a4010 派发合并 | 5469 通过、4 跳过 | 全部 0 |
| 192da920 合并行列出各条（D8） | 5473 通过、4 跳过 | 全部 0 |
| 4811d68e 收紧合并提示词（D8） | 5473 通过、4 跳过 | 全部 0 |
| c9da9572 核对退回（D9） | 5495 通过、4 跳过 | 全部 0 |
| 73ac7aa1 派发核对（D9） | 5499 通过、4 跳过 | 全部 0 |

- **满足。**

### O2 检查

- 编码代理的证据：D2、D3 的问题行测试在改 `lane-check` 之前是红的，之后变绿；一个全部合格的正例；把 `aggregate` 改成 `{ laneChecks: true }` 时 D4 的测试变红（旧形状、核对过的章节不判失败）。
- 在复制的泳道夹具上加 `### Permissions` 与列表式待确认项，`check-lane` 给出两条问题行与第 2 次尝试的 `Next:` 行。
- **满足。**

### O3 合并

- 夹具四章：跨章与同章的重复、一章用列表写待确认项、一章没有待确认项。表的行数、保留行的文字与位置、`not merged` 两种情形、两次 `aggregate` 字节相同，各有测试。
- 变异（每次改完从副本还原）：
  - 一个 id 放进两组的检查关掉：2 个测试变红；
  - `digest` 比较关掉：4 个变红；
  - 保留行的位置改取 `keep`：2 个变红；
  - D8：去掉 `Also asked in` 行 4 个变红，顺序反过来 5 个变红，把 `keep` 也列进去 5 个变红；
  - D9：忽略 `same` 5 个变红，跳过成对覆盖的检查 1 个变红，退回的条目放在组的位置 3 个变红；
  - 提示词：删掉「拿不准判否」、删掉按问题行选派核对子代理、删掉文件表一行，契约测试各自变红。
- **满足。**

### O5 真实冒烟

真实成员，Sonnet，`--fresh`，`--out` 在 scratchpad，$40 预算，沙箱。

- 8 个功能全部 `verified`。
- 流程与自动类章节里不是流程的 `###`：0。
- 含两个以上权限角色名的表：0（基线 5）。
- 每章待确认项都是一张三列表，表头一字不差（8/8）。
- `check-open-items` 退出 0：`Open items: 36 written in the chapters, 36 after merging`。合并子代理没有分组。
- `## Open items` 是一张表；语料 `.excavator/` 运行前后不变。
- 记录：
  - `PRD.md` 2477 行、225,827 字节（基线 3406 行、271,076 字节，−17%）；
  - 流程与自动类章节引言共 24,617 字节（基线 1,315）：权限与设置从 `###` 小节移进了引言；
  - 待确认项 36 条（基线表里 90 行）：核对解决了的项不再留在表里；
  - 流程索引 19 行（基线 28）；参考章节只有 1 章；
  - $37.39，5046 秒。
- **满足。**

### O6 独立审读（Sonnet）

- 单篇的 14 个用户流程与 3 个自动流程都在拼装版里有覆盖它的流程行；单篇另 3 个不是流程的条目内容在正文里。
- 合并：没有组，误合不适用。
- **照记**：
  - 合并后的表里问同一个问题的成对事项：0；部分重叠 2 对；
  - 流程章节不再重复参考章节的矩阵；但共用的 OAuth 设置与令牌字段、有效期在 F2–F8 的引言里重复（约 60 行），因为这次的划分没有令牌的参考章节；两章的引言放了设置表。
- **满足。**

### O7 合并演练

O5 的事项没有重复，合并步骤在真实运行里没有被真正用到，所以在基线的 90 条事项上演练。三轮，每轮的提示词都与当时 `SKILL.md` 一字不差：

| 轮 | 改动 | 组 / 合并的条目 | 独立审读判误合 |
|---|---|---|---|
| 1 | D5、D6 原样 | 12 组 / 18 条，90→72 行 | 2 组、2 条 |
| 2 | D8：合并行列出各条，提示词收紧 | 11 组 / 15 条，90→75 行 | 1 组、1 条 |
| 3 | D9：第 2 轮的分组加核对（合并提示词没变，沿用第 2 轮的 `merged.json`） | 核对退回 3 条，90→78 行 | 0 |

- 第 3 轮：`check-open-items` 退出 0，`Open items: 90 written in the chapters, 78 after merging; the check put back 3 of 15 merged items`。被退回的 3 条里有第 2 轮唯一的误合。
- 审读第 3 轮的 `PRD.md`：10 个合并行、12 条 `Also asked in`；同 8、部分 4、不同 0。78 行加 12 条正好是 90 条，每条恰好出现一次。
- **满足**（硬性项：任一合并行里有一条问的不是同一个问题，0）。
- **照记**：
  - 一个合并行的已知与搜过只回答了保留那条，没有覆盖另一条问到的页面；
  - 部分相同的 4 条里，有被合并的事项比保留那条问得更宽。

### 残余

- 共用的设置与令牌字段在没有对应参考章节时仍在各流程章节的引言里重复；章节的划分是编排者的判断，本变更不管。
- 旧形状的待确认项表（首列是序号）按三格抽取时，事项格只是一个数字，合并行里会显示成 `Also asked in F3: 4`。新运行的泳道检查要求三列表，真实冒烟 8/8 用了规定的表头；旧输出续跑时才会遇到。
- 合并与核对都是模型判断：核对只会让事项少合并，不会多合；演练只有一组输入。
