## 1. 校验器

- [x] 1.1 `validate-graph.mjs` 新增 `--reference <graph>`（`.jsonl` 或 `.json`），只用其节点 id 解析步骤的 `nodeIds`；读不出时非零退出、不写报告
- [x] 1.2 报告新增 `stepsTotal`、`stepsAnchored`、`stepsInferred`，与 `stepUnanchored` 守恒；终端汇总行同步
- [x] 1.3 测试：只在参照图里的锚点传参照图时算已锚定、不传时算未锚定；守恒；参照图读不出时失败；修复前第一个测试失败

## 2. domain skill

- [x] 2.1 Phase 4.5 的校验命令在知识图谱存在时传 `--reference "$DATA_DIR/knowledge-graph.jsonl"`
- [x] 2.2 汇报改为步骤总数与三类计数，并说明 `nodesChecked`、`edgesChecked` 为 0 时这两项检查不适用于 domain 图

## 3. 验证

- [x] 3.1 受影响的测试与 `node scripts/check-refs.mjs` 通过
- [x] 3.2 用部署测试留下的 domain 中间产物和知识图谱复跑：修复前 57 个未锚定，修复后 57/23/0
