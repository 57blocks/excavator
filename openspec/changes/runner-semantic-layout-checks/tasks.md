## 1. 先写会红的测试

- [x] 1.1 `checkProduct` 的用例：模型在 `semantic-graph.json` 且等于请求值通过；`unknown`、缺失、不同 ID、文件不存在、不是 JSON 各自失败且原因写明文件名；事实图里的 `project.model` 不再起作用。在当前代码上这些先红
- [x] 1.2 校验器层检查的用例：图没有层、同目录语义图的层完整时无层问题；语义图的层引用不存在的节点、一个节点在两层、漏掉一个文件节点，各自被报；语义图缺失、不是 JSON、没有 `layers` 时每个文件节点被报；图自带层时不读语义图。在当前代码上先红
- [x] 1.3 `planFullRun` 的用例：语义图的 `factDigest` 等于事实图的 `factsDigest` 且 commit 等于 HEAD 时跳过；只有 Lazy 产物不跳过；有语义图但 `factDigest` 不同或 commit 不同走 `--mode=full`；语义图读不出或没有 `factDigest` 走 `--full`；`--force` 走 `--full`；事实图里的 `pipelineVersion` 不再起作用。在当前代码上先红
- [x] 1.4 SKILL.md 契约用例：F3 的 `--model` 取值是 `EXCAVATOR_MODEL`，未设取 `ANTHROPIC_MODEL`，再没有才 `unknown`

## 2. 实现

- [x] 2.1 `deploy/run-excavator.mjs`：`checkProduct` 读语义图的 `model`，`planFullRun` 按语义图判断 full 产物与新鲜度，调用处读 `semantic-graph.json`
- [x] 2.2 `skills/excavator/validate-graph.mjs`：CLI 读同目录语义图的层，`validateAgainstSource` 加可选入参 `layers`
- [x] 2.3 `skills/excavator/SKILL.md`：F3 的 `--model` 一行

## 3. 验证

- [x] 3.1 变异检查：`checkProduct`、`planFullRun` 与层读取各去掉一条规则（`unknown` 判断、文件名原因、图自带层时的优先、读不到时的空层、`ANTHROPIC_MODEL` 回退），测试要变红
- [x] 3.2 只跑受影响范围：`tests/deploy`、校验器的三个测试文件、SKILL.md 契约测试，以及 `check-refs`、`openspec validate --all --strict`
- [x] 3.3 本地验收（真实 full 产物，74 文件切片，Sonnet 5.5）：产物与跳过、完整性、F3 重写各验一遍，结果见 `acceptance.md`
- [ ] 3.5 构建镜像，在 EC2 上对同一切片重跑 `full` 冒烟（Sonnet 5.5，预算 $20，30 分钟，看门狗），确认 Bedrock 路径上同样通过；合并之后做，不阻塞合并
- [x] 3.4 `docs/deploy.md` 里若写了产物检查读事实图的模型名或层，改成新位置（先 grep，没有则不改）
