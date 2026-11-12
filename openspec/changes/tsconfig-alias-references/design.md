## 决定

### 1. 作用域：一个配置的别名用于哪些文件

逐文件向上找最近的 `tsconfig.json` 这一点不变。这个配置给出若干**作用域** `{scopeDir, anchorDir, paths}`：

- 自己一个（含 `extends` 继承来的），`scopeDir` 是它的目录；
- `references` 每一项一个，`scopeDir` 是**被引用配置的目录**。

一个文件只用 `scopeDir` 包含它的作用域。

TypeScript 的真实规则是按被引用配置的 `include` / `files` / `exclude` 判断文件归属。这里不实现 glob 匹配，用目录近似，理由：`include` 默认就是配置所在目录，实际写法也几乎不越出这个目录（`src`、`src/**/*`）。代价有两个方向：

- 同一目录下的多个被引用配置（Vite 的 `tsconfig.app.json` 与 `tsconfig.node.json`）都作用于整个目录，所以它们的别名会互相「看见」对方的文件。只有当两边都解析出文件且文件不同时才会出错，这种情况走第 3 条的歧义桶，不会画错边。
- 如果一个配置用 `include: ["../x"]` 越出自己的目录，这部分文件拿不到它的别名，留在 `unresolved`，是可见的遗漏，不是编造。

没有做的反面：「被引用配置的别名作用于根配置下的所有文件」。它会让 monorepo 根目录下的脚本借到某个包的 `@/*`，解析到别的包的文件，这是编造。测试「applies a referenced config only to files inside its own directory」钉住这一点。

### 2. 继承：`extends`

只跟随相对路径（以 `.` 开头）。数组形式按顺序合并，后面的覆盖前面的，自己的覆盖继承的。`baseUrl` 与 `paths` 各自独立继承，各自记住**写出它的配置的目录**：有 `baseUrl` 时目标锚定在 `baseUrl`（相对写出它的配置），没有时锚定在写出 `paths` 的配置的目录。这与 TypeScript 4.1 起的规则一致；单文件时与旧行为完全相同（旧代码的默认 `baseUrl: "."` 就是配置自己的目录）。

`references` 不经 `extends` 继承（TypeScript 也是如此）。只跟随一层 `references`，不跟随引用的引用。

### 3. 冲突：多个作用域给出不同的文件

同一个说明符，对所有适用的作用域分别解析（每个作用域内部仍是「第一个匹配的别名、第一个存在的目标」），收集不同的结果：

- 0 个：照旧进 `unresolved`；
- 1 个（或几个作用域给出同一个文件）：画边；
- 2 个以上：**不画边**，进新的 `ambiguous` 桶 `{文件: {说明符: [候选…]}}`，并从 `unresolved` 去掉，保证一个说明符只落一个桶。覆盖账本据此按语言产出 `imports-ambiguous`，样本写作 `路径 → 说明符 (候选1 | 候选2)`。

选「不画边」而不是「按声明顺序取第一个」：零编造是硬指标，哪一个配置编译这个文件这里判断不了，取第一个就可能画一条错边；不画边的代价是一条可见的遗漏。单独成桶而不是并进 `unresolved`：`unresolved` 的说明文字是「没有指向项目内任何文件（外部包或坏路径）」，歧义说明符恰恰指向了项目内的文件，混在一起会让读者以为是外部包。

### 4. 跟随不了的条目

- 配置文件存在但读不了、解析不了：照旧 Warning: 加一条 `failures`（`resolver-config-read` / `resolver-config-parse`），同一个文件被多处引用也只记一次。
- `extends` / `references` 指向不存在的文件、离开项目根目录（按字面路径与 realpath 两次检查）、`extends` 成环：**只告警**。理由：增量运行遇到任何 `failures` 都会中止；而「离开根目录」在把 monorepo 的一个子项目单独分析时很常见（`extends: "../../tsconfig.base.json"`），「不存在」可能只是该文件不在所选源码里。两者都不是本次运行的错误。缺了这些别名的 import 留在 `unresolved`，在那里可见。
- 写成包名的 `extends`（`@tsconfig/node20/tsconfig.json`）不跟随，也不告警：别名是项目自己的，包里的基础配置几乎不写 `paths`；万一写了，受影响的 import 同样留在 `unresolved`。

### 5. 增量运行

增量运行原来只在名字恰好是 `tsconfig.json`（及 go.mod 等）的文件改动时整表重算。现在别名可以来自任意名字的配置（`tsconfig.app.json`、`configs/shared.json`），按名字猜不全。改为由 import map 输出 `tsConfigFiles`：本次构建别名时读过的全部 tsconfig 文件。选择性重算之后，若改动的路径与它相交，就整表再算一次。

只看「当前」链就够：一个文件离开链，一定是链上某个仍在的配置被改了（删掉了引用或 `extends`），那个配置本身就在改动里。新增的文件本来就触发整表重算。

## Oracle（动手前写死）

- 夹具（Vite 布局）：根 `tsconfig.json` 为 `files: []` 加两个 `references`；`tsconfig.app.json` 带注释与尾逗号，`baseUrl: "."`、`paths: {"src/*": ["./src/*"]}`；`src/App.tsx` import 两个别名模块（一个经 `index.ts`）、一个相对模块、一个外部包。期望三条边，`unresolved` 只有外部包。旧代码上必须红。
- 端到端：同一夹具跑 `lazy-analyze.mjs`，`src/App.tsx` 的 `imports` 边从 1 条变为 3 条，`imports-unresolved` 不再含两个别名说明符。
- 护栏：包外的文件不借用被引用包配置的别名；两个配置给出不同文件时无边、进 `ambiguous`、不进 `unresolved`；给出同一文件时有边；只有自己别名的旧夹具全部不变。
