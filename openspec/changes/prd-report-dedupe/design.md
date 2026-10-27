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
  - 不在组里的事项各一行；
  - Features 列为组内各条的功能 id，按章节顺序去重；
  - 合并不通过时每条各一行；没有事项时为 `None.`。
- 覆盖小节加一行，与 `check-open-items` 的最后一行相同。
- 被合并掉的事项的原文留在各章节文件与 `sources.json` 里，`PRD.md` 只显示保留的那条。

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
5. `docs(openspec): record prd-report-dedupe acceptance`
6. `docs(openspec): archive prd-report-dedupe`

每个提交单独是绿的。

## Risks / Trade-offs

- 流程章节的检查更严：标题多一个非流程小节就多一次泳道尝试。换来的是重复内容不再有固定的位置。
- 合并的误判：
  - 把两个不同的问题分进一组，`PRD.md` 就只显示其中一条的原文，另一条只剩功能 id。原文仍在章节文件里。
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
- **O6 独立审读（Opus）**：只拿到两份 PRD、`open-items/sources.json`、`merged.json` 与源码。
  - **硬性不通过**：
    - 单篇流程索引的某一行在拼装版没有覆盖它的流程行（`failed` 且 `attempts` 为 2 的功能范围除外）；
    - 某一组里有一条与 `keep` 问的不是同一个问题。
  - **照记**：合并后的表里仍成对重复的事项数；流程章节里是否仍重复 `reference` 章节的矩阵或字典。
