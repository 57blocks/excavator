## Context

现状（main 7dc1fea8）：
- `scripts/ci/privacy-scan.mjs` 里私有名字的路径范围是 `['.', ':(exclude)pnpm-lock.yaml']`，语料名的范围在它之上再排除 `openspec`、`docs` 与根目录的 `*.md`，所以两份名单都不扫 lockfile。
- 脚本开头的说明写的是：私有名字在 `pnpm-lock.yaml` 之外处处禁止；语料名在 `openspec/`、`docs/` 与根目录 Markdown 之外禁止。主规格的说法相同。按这两处，语料名在 lockfile 里也禁止。
- ci-merge-gate 的 D3 只为私有名字写了 lockfile 例外的理由（随机哈希会被短名字偶然命中），O1 也只为私有名字列了「lockfile 除外」。
- 测试只有「私有名字在 lockfile 里不计」一例。把语料名范围里的 lockfile 例外去掉，现有 18 个测试全绿（O1 记录）。
- `:(exclude)pnpm-lock.yaml` 只排除根目录那一个文件，`packages/a/pnpm-lock.yaml` 这样的路径照常扫描（在临时仓库里实测）。本仓库只有根目录一个 lockfile。

lockfile 里的内容有三类（本仓库的 lockfile 9.0，顶层键为 `lockfileVersion`、`settings`、`importers`、`packages`、`snapshots`）：
- 完整性哈希：`sha512-` 加 base64，作者写不了也改不了；
- 第三方包的名字、版本与依赖关系，来自 npm registry；
- 作者能决定的内容：`importers` 下的工作区目录与每个依赖的 `specifier`。它们原样来自 `package.json`、`pnpm-workspace.yaml` 与工作区目录本身，这些文件与路径两份名单都扫。

## Goals / Non-Goals

**Goals:**
- 代码、脚本说明与主规格对两份名单的范围说同一件事，并写明 lockfile 例外的理由；
- 语料名在 lockfile 里不计这件事有测试钉住。

**Non-Goals:**
- 改变扫描的范围或结果；
- 扫描嵌套目录里的 lockfile 的规则：仓库里没有这类文件。

## Decisions

### D1 保留例外：两份名单都不扫根目录的 `pnpm-lock.yaml`

理由：
- **偶然命中的理由对语料名同样成立，而且更强。** 私有名字是固定字符串；语料名单每行是一条正则，可以比一个固定字符串宽得多。用 main 上的 lockfile（3066 行、312 个完整性哈希）实测：随机的小写字母串在其中出现（不分大小写）的比例，3 个字母 55.2%，4 个字母 2.45%，5 个字母 0.077%，只看哈希也差不多。两侧都要求单词边界时，4 个字母降到 0.0042%（全文件 0.016%，多出来的是第三方包名里的词）。名单里每条正则是否带边界，仓库里看不到。
- **偶然命中修不了。** 检查只输出计数，不输出命中的文字；命中落在哈希里时，作者看不到是哪一行，也改不了哈希。唯一的出路是改 secret 里的名单。
- **例外不漏掉作者写的东西。** 作者在 lockfile 里能决定的内容都还写在 `package.json`、`pnpm-workspace.yaml` 或工作区的路径里，这些两份名单都扫。lockfile 里其余的文字是哈希与 registry 上第三方包的数据。

备选：去掉语料名范围里的 lockfile 例外，让代码跟上原来的说明与规格。不取：
- 它多拦下的只有上面两类没人写的文字，代价是更新依赖时可能出现无法诊断、只能靠改名单解决的红灯；
- 它是否会在当前的 lockfile 上偶然命中，取决于名单的真实内容，仓库里只能用合成名单测，测不出真实名单的情况；而每次重新生成 lockfile，哈希都会换一批。

### D2 说明与规格的写法

- 脚本开头：两份名单各自的范围里都写上 lockfile，再用一段话写理由，与 D1 的三条对应。
- 声明路径范围的那两行前加一行注释，说明语料名的范围是在私有名字的范围上再排除验收记录所在的地方，lockfile 例外随之继承。这次的不一致正是由这个继承关系没写出来造成的。
- 主规格：把「私有名字在 lockfile 之外处处禁止」一句改为两份名单都不扫根目录的 `pnpm-lock.yaml` 并写明理由，再列各自的范围；加一个场景。

### D3 测试带正对照

新测试把同一行（一个完整性哈希，中间有一段合成语料名，两侧是 base64 里的 `/` 与 `+`）同时写进 `pnpm-lock.yaml` 与 `src/` 下的一个文件，期望只有 `corpus added lines` 为 1。代码文件那一处证明这一行确实与正则匹配；只在 lockfile 里写时，计数为 0 也可能只是正则没匹配上。

## Oracles（动手前写死）

- **O1 装置**：
  - 新测试在当前代码上通过；
  - 变异 A：语料名的范围不再排除 lockfile。改前的测试套件在 A 上全绿（缺口），加了新测试后新测试变红，且是唯一变红的测试；
  - 变异 B：私有名字的范围不再排除 lockfile（语料名照旧排除）。原有的私有名字测试变红，新测试不受影响。
  - 每个变异做完还原，`git diff` 为空。
- **O2 检查**：
  - `pnpm vitest run tests/ci/privacy-scan.test.mjs` 绿，并在模拟 Linux 的环境（短 `TMPDIR`、`user.useConfigOnly=true`）里再跑一次；
  - 三件套绿；`openspec validate --all --strict` 绿；
  - PR 上 `CI gate` 与 `Privacy scan` 绿。
- **O3 隐私**：`scripts/`、`tests/` 的新增行汉字数为 0；改动行、提交信息与 PR 正文里没有私有名字与语料名，测试只用合成名单。

## Risks / Trade-offs

- [名单里有一条正则恰好匹配某个第三方包名，而这个包第一次进 lockfile] → 不计。第三方包名不是这个仓库写出的私有材料；把它列进依赖的 `package.json` 那一行照常扫描。
- [有人在仓库里加了第二个 lockfile] → 它会被两份名单照常扫描，偶然命中可能重新出现。到那时再按这里的理由扩大例外。
- [语料名只出现在 lockfile 里，其他地方都没有] → 按上面的内容分类，只可能是哈希或第三方数据，不是作者写进去的。
