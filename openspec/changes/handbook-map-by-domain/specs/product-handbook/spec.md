## ADDED Requirements

### Requirement: 业务领域

地图通过 `check-map` 之后，运行 SHALL 把地图里的每个功能归进一个业务领域，写成 `<out>/domains.json`。业务领域是读者在一起处理的一类业务对象或一段业务，可以横跨地图的几个区域。提交某个对象的功能，与审批、查看它的功能 SHALL 在同一领域。自己运行的功能 SHALL 在它处理的对象所在的领域。地图 SHALL NOT 因此改变。

`check-domains` SHALL 检查：
- 每个地图功能恰好在一个领域里；
- 领域编号从 `D1` 起连续，且没有空领域；
- 领域名过与区域名相同的读者文字与叙述语言检查。

不通过时，`check-domains` SHALL 退出 1，并逐行打印问题。

续跑时，通过检查的 `domains.json` SHALL 被保留。没有 `domains.json` 的旧输出目录续跑时，SHALL 补写它，而不重写地图与条目。

产品视角的导航、领域页与按领域的汇总 SHALL 取 `domains.json` 的领域。没有通过检查的 `domains.json` 时，SHALL 退回地图的区域，并用固定文字写明这是按导航分的区域。

#### Scenario: 申请与审批在不同菜单下
- **WHEN** 员工在一个菜单下提交休假申请，上级在另一个菜单下审批休假
- **THEN** 两个功能在地图里各自的区域与到达方式不变，在 `domains.json` 里属于同一个领域

#### Scenario: 漏归一个功能
- **WHEN** `domains.json` 没有包含地图里的 F7
- **THEN** `check-domains` 退出 1，并打印 F7

#### Scenario: 旧输出目录续跑
- **WHEN** 一个输出目录有已核实的地图与条目，但没有 `domains.json`，再次运行
- **THEN** 只写 `domains.json`，地图与条目逐字节不变，手册的产品视角按领域组织
