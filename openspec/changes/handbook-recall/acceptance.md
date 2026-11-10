## 验收记录

### O1 脚本测试

- 本 skill 的测试与合约测试：75 个文件、1832 个测试全部通过。其中新增 `name-keys.test.mjs`；`verify.test.mjs`、`overview-unit`、`findings-unit`、`system-unit` 覆盖四种单元。
- `roundTwoPlan` 的名称比较原先在不传名称时会静默跳过。现在名称改为必填参数，不传就报错。

### O2 变异

在分离检出里先 `pnpm -r build`，基线 1604 个测试全部通过。然后逐个变异：

| 变异 | 结果 |
|---|---|
| 第一轮仍删除 `contradicted` 的项 | 69 个测试变红 |
| 第二轮不比较名称与标签 | 17 个测试变红 |
| `narrowed` 不记录第二轮删去的项 | 4 个测试变红 |

### O5 检查

- `node scripts/check-refs.mjs`：全部引用可解析。
- `openspec validate --all --strict`：67 项通过。
- 非 ASCII 扫描：本分支改动的 28 个非 OpenSpec 文件里，0 个有命中；对照文件能扫出命中。
- 名字扫描：新增行里 0 处命中。
- 全量门交给 CI。

### O4 真实运行

待运行（先报花费）。
