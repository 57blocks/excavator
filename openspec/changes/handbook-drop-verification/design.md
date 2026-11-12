## 决定

### D1 按引用删

- 起点是技能文字（`SKILL.md`、`sections/*.md`、`stages/*.md`）调用的命令集合；命令表里不在其中的十条命令删掉。
- 库模块：删掉十条命令后，从保留的命令出发沿 import 走不到的模块删掉；走得到的保留，哪怕名字里有 verify 或 trace。
- 子代理：技能文字只派发 `excavator-handbook-writer`；其余五个删掉。

### D2 状态不变

- `confirmed`、`verified` 仍是合法状态、仍算已完成。组装、页面与 `reply` 对它们的读法不变。
- 不迁移旧的输出目录。

### D3 说明

- frontmatter 的 description 去掉核对员与追查员，写成：模型写的每一部分写一次、由脚本检查引文与值、在页面上标明未核对。

## Oracle

- **O1**：命令表里的每条命令都出现在技能文字里（合约测试，换回删除前的命令表要变红）。
- **O2**：`agents/` 里以 `excavator-handbook-` 开头的只有 `writer`；部署夹具与工具合约测试相应更新。
- **O3**：受影响测试（handbook 测试目录与合约测试）全绿；`typecheck`；`openspec validate --all --strict`；零非 ASCII；名字扫描。
