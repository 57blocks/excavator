## ADDED Requirements

### Requirement: TS/JS JSX 元素引用生成 calls 边

TS/JS 抽取器 SHALL 在用 tsx 或 javascript 语法解析的文件里，记录每个 JSX 开标签与自闭合标签写下的标签名与行号；闭合标签与片段 `<>` MUST NOT 计入。
- 标签名是小写开头的标识符、含 `-` 的标识符、或带命名空间的名字（`svg:rect`）时，该元素是内建元素，SHALL 只计入内建元素数，MUST NOT 产生边或 gap。
- 成员表达式标签（`<UI.Button>`）从不是内建元素。
- 标签的根名字被外层函数的参数、局部变量、局部函数或类、`catch` 参数、`for…in/of` 变量绑定时，抽取器 SHALL 标记该元素为局部绑定。绑定按函数作用域收集，偏向多标（多标只会把元素推进 gap，不会生成错边）。

事实图 SHALL 按以下顺序解析每个非内建元素的根名字：
1. 局部绑定的元素，以及语法从错误中恢复出的标签（javascript 语法把 `<this.Foo/>` 读成 `<Foo/>`，名字不是源码写的），落进 `jsx-unbound`；
2. 本文件 import 的绑定（具名、默认、命名空间）：说明符没有解析到仓库文件时，import map 列为外部的落进 `jsx-external`，其余落进 `jsx-target-unresolved`；解析到文件时，在该文件的导出里找导入名；
3. 本文件顶层声明的函数或类；
4. 都没有，落进 `jsx-unbound`。

在文件导出里找名字时 SHALL 先跟显式转发（`export { A as B } from`），再找本地导出（`default` 匹配默认导出，其它名字匹配非默认的同名导出；按本地声明名在本文件的作用域里解析：是本文件 import 的绑定时沿该 import 继续，是顶层函数或类时定位该节点），最后跟 `export * from`（默认导出不经 `export *` 转发）。转发链按已访问集合截断环路，MUST NOT 设深度上限。`export *` 给出多个不同目标时落进 `jsx-ambiguous`；没有找到且某个 `export *` 指向仓库外时落进 `jsx-external`；其余没有找到的落进 `jsx-target-unresolved`。

成员表达式标签的后续段 SHALL 只在命名空间（`import * as`、`export * as`）上继续解析；落在函数或类之后还有段（值的属性）、或整个标签只是命名空间时，落进 `jsx-target-unresolved`。解析出多个候选声明时落进 `jsx-ambiguous`。

目标唯一时，调用者 SHALL 是本文件行范围包含该元素的函数节点；恰好一个时生成从调用者指向目标的 `calls` 边，provenance 为 `extracted`，证据带标签名原文 `token`；没有或多于一个时落进 `jsx-caller-unresolved`。一个元素 MUST 恰好落进一处：边或五个 `jsx-*` gap 之一。

`coverage.jsxElements` SHALL 记录文件数、内建元素数、调用点数与各去向计数；import map 没有提供 `resolvedSources` 时记为 `not-run`。同一调用者对同一目标的多个元素合成一条边，证据取第一个调用点；该对已有 `calls` 边时沿用已有的边；计数仍按调用点。构建 SHALL 校验调用点数 = 成边的调用点数 + 各 gap 数，且各 gap 数与 gaps 里同种类的计数一致，不成立时以非零状态退出。

#### Scenario: 自闭合元素经具名 import 成边
- **GIVEN** `page.tsx` 的函数 `Page` 里写着 `<Button />`，文件顶部 `import { Button } from './button'`，`button.tsx` 导出函数 `Button`
- **WHEN** 构建事实图
- **THEN** 生成 `Page → Button` 的 `calls` 边，证据行是 `<Button />` 所在行，`token` 为 `Button`

#### Scenario: 默认导入换了本地名
- **GIVEN** `import Btn from './button'`，`button.tsx` 写着 `export default function Button`
- **WHEN** 构建事实图
- **THEN** `<Btn>` 生成指向 `Button` 的 `calls` 边，`token` 为 `Btn`

#### Scenario: 成员表达式经命名空间导入
- **GIVEN** `import * as UI from './ui'`，`ui.tsx` 导出函数 `Panel`
- **WHEN** 构建事实图
- **THEN** `<UI.Panel>` 生成指向 `Panel` 的 `calls` 边；`<UI.Missing>` 落进 `jsx-target-unresolved`

#### Scenario: 经转发桶文件
- **GIVEN** `index.ts` 写着 `export { Button } from './button'` 与 `export * from './card'`，页面从 `./index` 导入 `Button` 与 `Card`
- **WHEN** 构建事实图
- **THEN** 两个元素各自生成指向声明文件里组件的 `calls` 边，`index.ts` 获得指向两个被转发文件的 `imports` 边

#### Scenario: 内建元素不成边
- **WHEN** 函数里只有 `<div>`、`<my-element>`、`<svg:rect>`
- **THEN** 不生成边也不生成 gap，`coverage.jsxElements.intrinsic` 计入三个

#### Scenario: 被参数遮蔽的标签
- **GIVEN** 文件 import 了 `Icon`，函数 `Row({ Icon })` 里写着 `<Icon />`
- **WHEN** 构建事实图
- **THEN** 该元素落进 `jsx-unbound`，不生成指向导入的 `Icon` 的边

#### Scenario: 第三方组件
- **WHEN** 元素的根名字从 import map 列为外部的说明符（如包名）导入
- **THEN** 该元素落进 `jsx-external`，不生成边

#### Scenario: 顶层的元素没有调用者
- **WHEN** 元素写在模块顶层（例如 `const routes = [<Home />]`）
- **THEN** 目标可以解析，但没有包含它的函数节点，该元素落进 `jsx-caller-unresolved`

#### Scenario: 守恒被破坏
- **WHEN** 各去向计数之和不等于调用点数，或与 gaps 里的计数不一致
- **THEN** 构建以非零状态退出，不写图

### Requirement: TS/JS 的 import 绑定、转发与本地导出名

TS/JS 抽取器 SHALL 为每个 import 条目记录 `bindings`：本地名到导入名的对应，导入名是导出名、`default` 或 `*`（命名空间）。`export … from 'S'` 与 `export * from 'S'` SHALL 同时记为来源 `S` 的 import 条目，带 `reexports`（导出名到导入名，`export *` 记为 `*` 到 `*`，`export * as NS` 记为 `NS` 到 `*`），import map 因此为它们解析目标、桶文件获得 `imports` 边。导出条目的导出名与本地声明名不同时（`export { X as Y }`、`export default class X`、`export default X;`）SHALL 记录 `local`；事实图的 `exports` 边 SHALL 按 `local`（没有则按导出名）找声明。import map SHALL 为 TS/JS 文件输出每个解析成功的源说明符对应的仓库文件（`resolvedSources`）。

这些字段都是可选的；没有它们的结构结果照旧有效。

#### Scenario: 默认导出标识符
- **WHEN** 文件写着 `function Home() {}` 与 `export default Home;`
- **THEN** 导出条目是 `{ name: 'default', isDefault: true, local: 'Home' }`，事实图生成从文件指向 `Home` 的 `exports` 边

#### Scenario: 改名导出
- **WHEN** 文件写着 `export { Inner as Outer }`
- **THEN** 导出条目带 `local: 'Inner'`，`exports` 边指向 `Inner` 的节点
