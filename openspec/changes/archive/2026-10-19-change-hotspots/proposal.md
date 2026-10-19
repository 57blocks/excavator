## Why

做现代化规划，要知道哪些代码改得最多、体量又大。Excavator 目前不读 Git 历史。

在 sakai（5.5 万次提交、1.8 万个文件）上实测：
- 一次 `git log --numstat` 约 30 秒。
- 历史里出现过 8.6 万个路径，HEAD 里只剩 1.8 万。
- 不沿改名链把历史归到当前路径，31% 文件的提交数会变，中位数少一半，前 20 名换掉 6 个。
- git 默认的改名检测有文件数上限，超过就跳过。在 sakai 上它只打印一条本地化的警告，漏掉 214 次改名。

这些都是全仓普查和按目录去重计数，让模型每次现写 awk，既不可测也不可复现，所以要一个确定性脚本。读数、按模块提问、汇报交给模型。

## What Changes

- 新增脚本 `skills/excavator/hotspots.mjs`：
  - 读 HEAD 可达的提交历史；
  - 对选中的每个文件和它的每级目录，算窗口内的提交数、作者数、增删行数与最后修改时间；
  - 文件热点分 = 提交数 × HEAD 行数；
  - 写出 `.excavator/hotspots.json`。
- 没有历史的情况落进看得见的分类，不报成 0：
  - 非 Git 目录；
  - 浅克隆（计数只是下限）；
  - 多仓父目录里不属于任何成员仓的文件；
  - 二进制文件（没有行数，不打分）。
- 新增 skill `/excavator-hotspots`：跑脚本，按产物汇报排名靠前的文件与目录，并列出残余假设。只陈述现状，不给建议。
- `excavator-chat` 回答改动历史类问题时读这个产物，并检查它是否过期。
- 不做：
  - 不加 MCP 工具。MCP 的工具面是封闭清单，unused-code 也是「产物 + chat」的做法。
  - 不用事实图。行数取自源码快照，与事实层读同一份 HEAD；符号数对没有解析器的文件类型恒为 0，会把 XML、配置排成体量为零。
  - 不改事实图与 Lazy、Full 流程。

## Capabilities

### New Capabilities

- `change-hotspots`：按 Git 历史统计改动热点。包括历史的读取与改名归属、计数与打分、没有历史时的分类、守恒、产物，以及 skill 与 chat 的读法。

### Modified Capabilities

（无）

## Impact

- 新文件：
  - `skills/excavator/hotspots.mjs`
  - `skills/excavator-hotspots/SKILL.md`
  - 对应测试
- 修改：
  - `skills/excavator-chat/SKILL.md`：新增一节；
  - `README.md`：命令列表；
  - `tests/install/install.test.mjs`：skill 数加一。
- 依赖：只用宿主上的 `git`（Lazy 已经依赖它），不新增依赖。
- 运行器与部署镜像不变。注意：运行器用 `git archive` 导出样本，导出的副本没有历史，产物会如实报「没有历史」。
