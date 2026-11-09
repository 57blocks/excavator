## MODIFIED Requirements

### Requirement: 逐项核对

条目通过脚本检查后，每个带出处的项 SHALL 由一个只看到该项主张与所引源码前后文的核对子代理给出 `verified`、`unverified` 或 `contradicted` 之一的判词。脚本 SHALL 检查每一项恰好有一个判词，不成立时什么都不记录。第一轮两名核对者中任一名判 `contradicted` 的项 SHALL 当即从条目里删去，SHALL NOT 改写。其余没有两名都判 `verified` 的项 SHALL 改写一次并再核对一次；改写 SHALL 只换或加这些项的引文，SHALL NOT 改动它们的主张，也 SHALL NOT 改动没被列出的项。第二轮仍不是 `verified` 的项 SHALL 从条目里删去。两轮删去的项 SHALL 连同主张、判词与理由记录下来，并在手册的覆盖一节列出。核对者定案后，留下的每一项 SHALL 再由两个互不相见、都能读整个项目的追查子代理各自找反证，各写自己的判词文件，判为 `holds` 或 `contradicted`；`contradicted` SHALL 带项目内的文件与行号，脚本 SHALL 拒绝指向项目外或超出文件行数的位置。脚本 SHALL 对每个判词文件单独检查每一项恰好一个判词与上述位置，任一文件缺失或被拒时什么都不记录，并只点名要重派的那几个判词文件。两名追查者中任一名判 `contradicted` 的项 SHALL 删去并同样记录，记录 SHALL 带每一名判 `contradicted` 的追查者的理由与全部位置。只有追查也完成的功能 SHALL 进入手册正文。

#### Scenario: 与代码矛盾的项
- **WHEN** 一项主张说某角色能取消，而所引源码里的权限判断只放行另一个角色，第一轮一名核对者判为 `contradicted`
- **THEN** `verdicts --round 1` 当即删去该项，它不进改写文件，也不出现在手册正文里，覆盖一节列出它被删去及理由

#### Scenario: 第一轮只有矛盾的项
- **WHEN** 第一轮没有两名都确认的项全是 `contradicted`
- **THEN** `verdicts --round 1` 删去它们并记录，不写改写文件，功能直接 `confirmed`；删完后没有一项留下证据时，功能 `failed`

#### Scenario: 改写改了主张
- **WHEN** 改写文件列出的一项，第二轮条目里它的主张与第一轮不同，只是换了引文的项不算
- **THEN** `slices --round 2` 拒绝，打印该项的位置，并说明只能换引文

#### Scenario: 反证在没给出的代码里
- **WHEN** 两名核对者都确认了一项，一名追查者读到被调用函数的函数体，发现它与主张不符，给出该函数所在的文件与行号
- **THEN** `trace-verdicts` 删去该项并记录理由与位置，覆盖一节列出它被删去

#### Scenario: 一名追查者放过，另一名找到反证
- **WHEN** 同一份的两名追查者里，一名判一项 `holds`，另一名判它 `contradicted` 并给出项目内的位置
- **THEN** `trace-verdicts` 删去该项，记录带判 `contradicted` 那一名的理由与位置

#### Scenario: 两名追查者都找到反证
- **WHEN** 同一份的两名追查者都判一项 `contradicted`，各给出理由与位置，其中一个位置两名都给了
- **THEN** 记录带两条理由，位置是两名给出的全部位置，重复的那个只留一个

#### Scenario: 一名追查者的判词文件缺失
- **WHEN** 一份的第一名追查者写了有效的判词文件，第二名没有写
- **THEN** `trace-verdicts` 退出 1，不记录任何判词，`Next:` 行只点名这一份的第二名

#### Scenario: 反证的位置在项目外
- **WHEN** 一名追查者的判词里一个 `at` 的文件路径落在项目根之外，或行号超出文件行数
- **THEN** `trace-verdicts` 退出 1，打印该份、该名追查者、该项与位置，不记录任何判词

#### Scenario: 改写动了别的项
- **WHEN** 第二轮的条目里有一项不在改写清单上，却和第一轮不同
- **THEN** `slices --round 2` 拒绝，并打印该项的位置

#### Scenario: 判词缺项
- **WHEN** 核对文件里少了某一项的判词
- **THEN** `verdicts` 退出 1，打印缺判词的项，不记录任何判词
