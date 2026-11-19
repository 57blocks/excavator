提交序列（每组一个 commit，合并用 `--merge`，不 squash）：
1. `docs(openspec): propose http-links`
2. `feat(http-links): plan, check and pair commands`
3. `feat(http-links): skill prompt and reader subagent`
4. `feat(view): http-links product state and request edges`
5. `test(http-links): contracts and acceptance record`

## 1. 脚本：plan、check、pair

- [ ] 1.1 先写红测试：
  - `plan`：
    - 嵌套清单归外层；
    - 没有清单的顶层目录；
    - 超过 `--shard-files` 时按子目录分；
    - 指纹只随分片内文件的内容变化；
  - `check`：D3 的 6 条各一个拒绝样例。另有：越界路径不读、只计数；处理函数可选；文件路由以文件路径作依据；
  - `pair`：
    - D5 的统一写法：`:x`、`{x}`、`<x>`、`${...}`、`[x]`、`*x`、`[...x]`；
    - 字面胜参数；
    - 参数对字面只有一个候选、多个候选；
    - 方法不同；
    - `ANY`；
    - 查询串；
  - 基地址：重合度最高且 ≥ 50% 时成立；选的不是最高、或低于 50% 时为冲突，整组请求进 `base-conflict`；映射为 `null` 时进 `base-unmapped`；
  - 守恒：每个桶至少一个样例，各桶之和等于请求总数；
  - 绊线：命中但没有依据行的文件进 `possiblyUnread`；
  - 缓存：指纹不变沿用旧答复，`--fresh` 不沿用。
- [ ] 1.2 实现 `skills/excavator-http-links/http-links.mjs` 的 `plan`、`check`、`pair`。库模块里不出现任何框架或语言名作为分支条件。
  - **验证：** 1.1 全绿；用框架名列表搜库模块，除绊线模式表外为零。
- [ ] 1.3 装置先验（design O1）：在测试里用一份按真实写法构造的答复，植入 6 类假条目，确认全部被拒、原答复全部通过。
  - **验证：** 测试绿。暂时去掉任一条核对规则时，对应植入不再被拒（变异检查，在分离检出里做）。

## 2. skill 与子代理

- [ ] 2.1 写 `skills/excavator-http-links/SKILL.md`（英文），内容包括：
  - 参数：项目路径、`--out`、`--fresh`、`--shard-files`；
  - 步骤：`plan` → 每个待跑分片派一个 `excavator-http-links-reader` → 每份答复一返回就 `check` → 编排者判断基地址并写映射 → `pair` → 对 `possiblyUnread` 补读一次 → 再 `pair` → 回复；
  - 回复语言与固定格式的最后几行由命令打印。
- [ ] 2.2 写 `agents/excavator-http-links-reader.md`：
  - 只读；
  - 不写解析脚本；
  - 依据行逐字抄；
  - 不懂的写法报 `path-unknown` 加原因；
  - 只写指定的答复文件。

  不写模型名。
- [ ] 2.3 插件清单登记 skill 与子代理，跑 `claude plugin validate`。
  - **验证：** `node scripts/check-refs.mjs` 与 `pnpm test` 绿。

## 3. 查看页

- [ ] 3.1 先写红测试：
  - `pack` 给 `http-links.json` 四种状态（included、not run、unreadable、different revision）；
  - 格式串不对时为 unreadable；
  - 页面数据里请求边按文件对聚合，只来自 `matched`。
- [ ] 3.2 实现产物读取与页面数据；图里加「请求」边的颜色与图例项；回复的产物行加上 http links。
  - **验证：** 3.1 全绿，三件套绿。

## 4. 验收

- [ ] 4.1 在 go-multirepo 与 mixed-suite 上按 design 的 O2–O8 跑，写 `acceptance.md`：
  - 测量条件：提交、语料、模型、花费上限；
  - 每次运行的花费与轮数；
  - 逐项结果与裁定记录。

  编造与遗漏分开算。
- [ ] 4.2 达标后同步 spec，开 PR；没达标的项照记，不挪达标线。
