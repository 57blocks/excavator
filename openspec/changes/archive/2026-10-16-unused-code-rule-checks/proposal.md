## Why

`unused-code` 归档前，两次审读之后给 skill 加了几条规则：测试代码一律 `test-entry`、程序启动每次都判入口、`medium` 只说名字在别处没有出现。这些规则当时只写成散文，没有用真实模型重跑验证。用 headless Sonnet 在 Fineract 与 dataverse 上重跑，有三条没有守住：

- **测试代码。**
  - 按机制写的宽查询（`equals`、`compareTo`、`afterPropertiesSet`）同时选中了测试与生产代码，整条记成 `entry`。Fineract 有 10 个测试代码 id 这样被判了。
  - 有一次，模型把两个对外发布的 SDK 模块算进了测试代码：仓库里只有测试依赖它们。
- **程序启动。**
  - 没有一次运行去读脚本的顶层代码：dataverse 的 Python 顶层调用一个都没判。
  - 有一次，Fineract 的 4 个 Java `main` 一个都没判。
- **汇报。** 有一次，Fineract 的汇报把 `medium` 说成「仓库里没有调用」，把 `unreferenced` 说成「没人调用」。它还用一个没有统计过的原因解释为什么没有 `high`：说是类上的注解。信号统计显示，多数 `medium` 是因为可见性才进不了 `high`。

散文规则在模型压力下会被跳过。能确定检查的，改成决定脚本里的检查；不能检查的，改成带清单命令的步骤，写在模型动手的地方。

## What Changes

- **测试代码由决定脚本检查。**
  - 模型在 Step 3 写出 `TEST_CODE`：一个匹配测试代码文件路径的正则，范围是测试源码目录，加上只被测试依赖、也不发布给其它项目的模块。
  - 决定脚本把它变成查询可用的 `test_code`，并拒绝两种决定：选中测试代码的 `entry`，和选中测试代码以外节点的 `test-entry`。
  - 记录下的查询带上 `test_code` 的定义，单独重跑也能选出同样的 id。
- **程序启动有清单。**
  - Step 3 列出名为 `main`、事实里没有调用者的候选。只要其中有一个没有决定，决定脚本就拒绝写出决定文件。
  - Step 3 还列出有调用事实的脚本语言里、函数没有调用者的文件，由模型读它们的顶层代码后决定。`calls` 为 0 的语言不列。
- **汇报只说产物里的事实。**
  - `medium` 小节的标题固定为「its name occurs nowhere else; needs confirmation」，并附 `medium` 的信号统计。
  - `unreferenced` 只说事实里没有引用。
  - 计数的解释只取自产物。
  - 汇总命令打出全部残余假设，汇报逐条列出。

脚本 `unused-code.mjs` 不变。改动全在 skill 文字与它的决定脚本配方里。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `unused-code`：
  - 「入口判断由宿主 skill 承担」增加三项：测试代码的范围排除对外发布的模块，决定脚本的两种拒绝，启动方法必须全部有决定。
  - 「产物、新鲜度与查询」增加 skill 汇报 `unreferenced` 与计数解释的约束。

## Impact

- `skills/excavator-unused-code/SKILL.md`：Step 3、Step 4、Step 6。
- `tests/skill/test_unused_code_skill_contract.test.mjs`：
  - 新规则逐条钉在所在步骤；
  - 直接执行 skill 里写的 Step 4 脚本，验证拒绝与拆分。
- 依赖不变：Node、`jq`、Lazy 事实。build-free。
