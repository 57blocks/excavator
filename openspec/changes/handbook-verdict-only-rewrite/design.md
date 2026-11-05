## Context

第 5 阶段现在的流程：
1. `slices` 切出第一轮核对文件，并留下条目快照 `verify/round-1/<id>.entry.json`；
2. 两名核对者各写判词，`verdicts --round 1` 合并（`combine-verdicts`：任一名 `contradicted` 即 `contradicted`，两名都 `verified` 才 `verified`，其余 `unverified`）；
3. 不是 `verified` 的项一律写进 `rewrite/<id>.json`，状态记 `rewriting: true`；
4. 改写子代理改条目，`slices --round 2` 用 `roundTwoPlan` 比快照，拒绝没列出却变了的项与增删的项；
5. 第二轮仍不确认的项由 `roundTwo` 经 `removalRecords` 删去并记进 `state.features[id].removed`。

## Goals / Non-Goals

**Goals**：检查环节不再写出新主张，第一轮 `contradicted` 的项直接删；改写只换引文，由脚本强制。

**Non-Goals**：不改核对者与追查者的定义、判词格式、切分规则；不改手册覆盖一节的渲染。

## Decisions

### D1 第一轮的删除复用第二轮的删除路径

`verdicts --round 1` 先把 `contradicted` 的项交给 `removalRecords` 删去（连同挂在下面的项），记录的形状与第二轮相同（主张、判词、理由），所以覆盖一节不用改。删完的条目要过 `entryProblems(..., { settled: true })`，与 `roundTwo` 相同。把 `roundTwo` 里「删项、判 failed、校验、写条目」这一段抽成两轮共用的函数，不复制。

删完后：
- 没有 `unverified` 项：功能 `confirmed`，有删除时带 `removed`；不写改写文件。
- 有 `unverified` 项：写剩下的条目，改写文件只列 `unverified` 项，状态 `{ status: 'checked', attempts, rewriting: true, removed }`（`removed` 只在有删除时出现）。
- 删完没有一项带证据：`failed`，与第二轮一致。

### D2 第二轮的比较扣掉第一轮已删的项

快照不改，它仍是第一轮看到的条目。`roundTwoPlan` 多收一个参数：第一轮删去的项的 id 集合（从 `state.features[id].removed` 读）。这些项和挂在它们下面的项，在当前条目里缺失不算 `missing`。第二轮定案时，`removed` 是第一轮的记录加上第二轮的记录。

理由：改写快照会丢掉「第一轮看到了什么」，而恢复运行与改写子代理都靠这份快照。

### D3 改写只换引文：比主张，不比指纹

列出的项（以及挂在它们下面的项）在第二轮的 `claim` 必须与快照里的 `claim` 逐字相同；不同就打印 `<item id>: listed for rewriting, but its claim changed; only its citations may change`。`claim` 是 `claims.mjs` 拼出的、读者被告知的全部内容（含字段、页面、操作等上下文），不含引文，所以只换引文的项能过，改了任何一个读者能看到的字的项过不了。没列出的项仍按指纹比，与现在相同。

### D4 改写子代理的提示词

「What you do」只剩一种做法：给项换或加一段本身就能证明它的引文（谁能做某事就引代码检查的条件），主张的文字、它挂在哪个页面、字段、操作下面，都不改。证明不了就原样留下，第二轮后由脚本删去。去掉「narrow the text」那一条。说明 `slices --round 2` 会拒绝改了主张的项。

### D5 旧运行的恢复

已在 `rewriting` 状态的旧运行，改写文件里可能有 `contradicted` 项，`state` 里没有 `removed`。它们按 D3 只能换引文，第二轮不确认就删。不需要迁移代码。

## Oracles

- **O1（夹具，脚本）**：
  - 第一轮一项 `contradicted`、一项 `unverified`：前者被删并记录，不在改写文件里；后者在改写文件里。
  - 第一轮只有 `contradicted`：功能直接 `confirmed`，带 `removed`，没有改写文件。
  - 第一轮删完没有带证据的项：功能 `failed`。
  - 第二轮：只换引文的列出项被接受；改了主张的列出项被拒，并打印上面那一行；第一轮删去的项缺失不报 `missing`；最终 `removed` 含两轮的记录。
  - 变异检查：去掉第一轮删除、去掉主张比较、去掉第一轮已删项的豁免，各至少一个测试变红。
- **O2（合约测试）**：SKILL.md 的改写提示词不再含「narrow」那条，含「只换引文」与 `slices --round 2` 拒绝改主张的说明；`verdicts --round 1` 的新输出行写进 SKILL.md。
- **O3（已知错误库，真实运行；Sonnet 是测量条件，不是产品要求）**：A 组与 B 组各跑一次，用与 #112 那一轮相同的打分脚本：
  - (a) 每个最终留在条目里的项，主张与它第一轮的主张逐字相同：0 处不同（脚本比对，不靠人判）；
  - (b) 真话被改成假话：0；
  - (c) 纠正或删去的错误不少于 7/14（#112 在 A 组上的成绩）；
  - (d) 被删的真话条数：只报告，不设线。删去是可见的覆盖缺口。
  - 任一条线没过，就在验收记录里照实写没过，不事后挪线。
- **O4**：受影响测试、`check-refs`、`openspec validate --all --strict` 在本地通过；全量门在分离检出里跑。

## Risks / Trade-offs

- 被核对者误判 `contradicted` 的真话（例如那条「说明可以不填」）现在直接删掉，拿不到改写的机会。这是覆盖损失，换来的是检查环节不写假话；覆盖一节会列出它与理由。
- 主张本身错、但改写能挽救成真话的项，以前能留下，现在删掉。错误库里这类有 2 项，删掉同样算纠正，O3(c) 不受影响。
