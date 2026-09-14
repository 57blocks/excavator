每组按仓库规则：先写失败验收 → 实现 → 验证 → 单独 commit。合成夹具用 purpose-built 项目，真实语料（go-clean-arch/wcp）验证 opt-in、产物不提交。

## 1. 节点身份契约（先落，去重支柱）

- [ ] 1.1 写身份五夹具并确认先红：同内容不同路径形态 → 同 ID；git 相对 vs 目录相对 → 同 ID；同文件不同 receiver 的同名方法 → 两个 ID；匿名 handler 前插注释/空行/非同类声明 → ID 不变、前插同类声明 → ID 可变但只失效不错配；两个可区分声明同 ID → 报 identity-collision。验证：该 vitest 套件（`tests/identity/`）先全部失败。
- [ ] 1.2 实现单一共享模块 `skills/excavator/node-identity.mjs`：path 规范化（含多仓成员前缀规则 `<memberId>/<member-relative-path>`）、`path+kind+owner+signature → name → owner 内同 kind 出现序号`（序号记 provenance）、身份冲突检测。验证：1.1 五夹具全绿。
- [ ] 1.3 让 Fact Builder 与 chat 缓存查找两侧都经此模块取 id，并与既有 `structure-all`/`annotate-graph` 锚点对齐（统一到一处入口）。验证：合成项目上 build 的 id 与 annotate 锚点逐一致（无漂移断言）。

## 2. 确定性 Fact Builder（投影）

- [ ] 2.1 写 fact-graph 验收并确认先红：零模型且同输入同投影；contains/exports/imports/唯一可解 calls 成边；call 不可解 → gap（不猜）；解析失败 → 可见 gap（不伪装无符号/已删除）；Lazy 节点 summary/tags/layers 为空；complexity 按非空行数分档；factsDigest 排除运行元数据。验证：套件先红。
- [ ] 2.2 实现 `skills/excavator/build-fact-graph.mjs`：读 `scan-result.json`+`structure-all.json`+import-map 投影节点/边；calls 用 import-map + 同文件本地绑定做唯一解析，不可解入 gap；不重新解析源码、不调用模型。验证：投影与 gap 用例绿。
- [ ] 2.3 产出 `coverage`/`gaps`（每输入落一桶、守恒折叠）与 `factsDigest`（对齐既有 `project.factsDigest` 口径，统一到一处实现，仅覆盖规范化事实、排除运行元数据）。验证：factsDigest 排除元数据用例绿 + coverage 守恒用例绿。
- [ ] 2.4 `complexity` 按非空代码行数确定性分档（<50/50–200/>200，阈值在 fixture 校准并固定）。验证：分档用例绿、可复现。

## 3. Lazy 首次运行流水线

- [ ] 3.1 配置：`.excavator/config.json` 增 `analysisMode`（默认 lazy）；`/excavator` 解析 `--mode=lazy|full`（单次覆盖不改配置）与 `--full`（=full+强制重建，不持久化）；存量已有完整图谱默认切 lazy 不清空/降级。验证：默认 lazy / --mode 单次覆盖 / 存量不降级 三场景绿。
- [ ] 3.2 改 `skills/excavator/SKILL.md` Phase 0 决策按 mode 分支：Lazy 走 `Scan → Structure-All → build-fact-graph → 确定性 validate → SAVE`，跳过 Phase 1.5/2/2.5/3/4/6。验证：lazy 首跑 analyzer/verifier/assemble/architecture/graph-review 调用数=0，且不产 LLM batch/HTML/Tour（用断言脚本或运行记录核对）。
- [ ] 3.3 确定性 validate 复用现有触源码校验（去掉 LLM review 分支）；SAVE 复用既有原子保存门，保存失败不推进 sourceRevision/manifest/fingerprints/meta。验证：注入保存失败 → 元数据不前进用例绿。

## 4. 结构类 chat 与语义降级

- [ ] 4.1 改 `skills/excavator-chat/SKILL.md` 增结构/语义分流：结构类问题（文件/符号/方法清单、import/calls、1-hop）直接用事实层回答、不触发语义补充；命中节点 summary 为空且问题需业务含义时输出固定降级提示（建议 `--mode=full`）且禁止编造。验证：结构问答用例绿 + 语义降级（零编造）用例绿。

## 5. 端到端、性能与门禁

- [ ] 5.1 合成端到端：一个 purpose-built 多语言小项目首次 lazy 运行 → 零 LLM、事实齐全、结构问答正确。验证：端到端套件绿。
- [ ] 5.2 opt-in 真实验证：对固定 `go-clean-arch` commit 跑首次 lazy，分阶段记录 snapshot/scan/import-map/parse/graph-build/validate/save 与总耗时（目标 <60s），把实测写入变更记录（源码/产物不提交）。验证：产出分阶段计时并记录实测。
- [ ] 5.3 门禁：`openspec validate --strict lazy-first-run` 通过；`pnpm test` 受影响套件与 typecheck 绿；无删除/跳过/弱化既有测试。验证：命令通过、无告警。
