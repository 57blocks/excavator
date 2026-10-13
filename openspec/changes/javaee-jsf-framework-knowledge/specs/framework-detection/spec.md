## Purpose

从被扫描的 manifest 确定性检测项目用到的框架，结果带可复核的证据并写入图头；框架约定附录按框架配置的 id 命名，由图头驱动注入分析提示。

## ADDED Requirements

### Requirement: 从被扫描的 manifest 确定性检测框架

扫描 SHALL 以已注册的框架配置为检测的唯一数据来源。

参与检测的文件：
- 文件已被扫描选中并读入，且文件名匹配某配置声明的 manifest 名，就以其内容参与该配置的检测。
- 匹配规则：精确文件名或路径后缀；`*.ext` 形式按扩展名后缀。
- 同一 manifest 名的所有匹配文件都参与，MUST NOT 只看其中一个。
- 被忽略、被默认规则过滤、敏感、过大、二进制或读取失败的文件不参与。

关键字的匹配：
- 不区分大小写，按子串匹配。
- 只在未被遮蔽的文本里算数（见「注释与排除声明不构成检测信号」）。

检出结果：
- 每个框架一条，包含框架 id、有命中的 manifest 文件数，以及第一处证据（文件路径、1 起的行号、命中的关键字）。
- 第一处证据取按路径稳定序的第一个有命中的文件，以及该文件里位置最早的命中。
- 结果按 id 排序。
- 相同输入 MUST 得到相同结果。

产品代码 MUST NOT 含任何框架专属的检测或分派逻辑：增加一个框架只增加一条配置数据。

#### Scenario: 子模块的声明被检出
- **WHEN** 根 `pom.xml` 不含任何 `javaee` 关键字，`orders/pom.xml` 第 31 行声明 `<artifactId>jakarta.jakartaee-api</artifactId>`
- **THEN** 检出 `javaee`，manifest 文件数为 1，证据为 `orders/pom.xml` 第 31 行、关键字 `jakarta.jakartaee-api`

#### Scenario: 多个文件命中时证据取稳定序第一个
- **WHEN** `b/pom.xml` 与 `a/pom.xml` 都声明了 `org.springframework`
- **THEN** 检出 `spring`，manifest 文件数为 2，证据位于 `a/pom.xml`

#### Scenario: 被忽略的 manifest 不参与
- **WHEN** 唯一声明 `spring-boot` 的 `samples/pom.xml` 被 `.excavatorignore` 排除
- **THEN** 不检出 `spring`

#### Scenario: 没有扩展名的 manifest 照常参与
- **WHEN** 仓库根目录的 `Gemfile` 写 `gem 'rails'`，扫描按普查规则把 `Gemfile` 记为未知语言、不列入文件清单
- **THEN** 仍检出 `rails`，证据为 `Gemfile` 的该行

#### Scenario: 没有命中不报告
- **WHEN** 仓库没有任何配置声明的 manifest，或 manifest 里没有任何关键字
- **THEN** 检出结果为空列表

### Requirement: 注释与排除声明不构成检测信号

检测前 SHALL 按 manifest 的文件格式遮蔽不构成依赖声明的文本：

| 格式 | 遮蔽内容 |
|---|---|
| XML（`.xml`、`.csproj`） | `<!-- -->` 注释；名为 `exclusions`、`exclude`、`excludes` 的元素及其全部内容 |
| Gradle（`.gradle`、`.gradle.kts`）与 `go.mod` | `//` 行注释与 `/* */` 块注释；从独立的单词 `exclude` 起到行尾；`go.mod` 的 `exclude ( … )` 块 |
| `requirements.txt`、`Pipfile`、`pyproject.toml`、`setup.cfg`、`setup.py`、`Gemfile` | `#` 到行尾 |
| 其他（如 `package.json`） | 不遮蔽 |

Gradle、`go.mod` 与 `#` 注释格式里，单行的 `'…'` 或 `"…"` 字符串中出现的 `//`、`/*`、`#`、`exclude` 不是注释或排除的起点。引号在本行没有闭合时不构成字符串。

遮蔽 MUST 保持行号不变。遮蔽只能减少命中，MUST NOT 产生原文没有的命中。

#### Scenario: Maven 排除不算使用
- **WHEN** 某 `pom.xml` 只在 `<exclusions><exclusion><groupId>org.springframework</groupId>…</exclusions>` 里写到 `org.springframework`
- **THEN** 该文件不为 `spring` 提供命中；仓库里没有其他命中时不检出 `spring`

#### Scenario: 注释掉的依赖不算
- **WHEN** `pom.xml` 写 `<!-- <artifactId>primefaces</artifactId> -->`，且没有其他 `jsf` 关键字
- **THEN** 不检出 `jsf`

#### Scenario: Gradle 排除语句不算
- **WHEN** `build.gradle` 只在 `exclude group: 'org.springframework.boot'` 一行写到 `spring-boot`
- **THEN** 该文件不为 `spring` 提供命中

#### Scenario: 字符串里的通配不遮蔽后文
- **WHEN** `build.gradle` 第 5 行写 `include '**/*.java'`，第 9 行写 `implementation 'org.springframework:spring-core:5.3.0'`，第 5 行的 `/*` 之后文件里再没有 `*/`
- **THEN** 检出 `spring`，证据为第 9 行

#### Scenario: 注释外的声明照常检出且行号不偏移
- **WHEN** `pom.xml` 第 10 行是含 `primefaces` 的注释，第 40 行是 `<artifactId>primefaces</artifactId>`
- **THEN** 检出 `jsf`，证据为第 40 行

### Requirement: 检测结果写入图头

事实构建 SHALL 把图头 `project.frameworks` 写为当次扫描检出的框架 id 列表，按 id 排序；未检出任何框架时为 `[]`。该字段每次运行重算，MUST NOT 沿用旧图的值。

检出证据 SHALL 随扫描结果保存在数据目录的中间产物里。

图头流水线版本 SHALL 变更，使源码未变的已有产物在下次同步时重建。检测 MUST NOT 改变事实：同一源码的节点、边与 `factsDigest` 与检测无关。

#### Scenario: 首次运行写入检出的 id
- **WHEN** 对一个声明了 `jakarta.jakartaee-api` 与 `primefaces` 的项目首次运行事实构建
- **THEN** 图头 `project.frameworks` 为 `["javaee", "jsf"]`

#### Scenario: 旧图的框架名被重算结果替换
- **WHEN** 已有图头的 `project.frameworks` 为 `["Spring Boot"]`，本次扫描检出 `spring`
- **THEN** 新图头的 `project.frameworks` 为 `["spring"]`

#### Scenario: 事实不受检测影响
- **WHEN** 同一源码在检测接入前后各构建一次
- **THEN** 两次的节点、边与 `factsDigest` 相同，图头只有 `frameworks` 与流水线版本不同（运行时间除外）

### Requirement: 附录按框架配置 id 命名并由图头驱动注入

附录与配置的对应：
- 每个已注册的框架配置 SHALL 在 `skills/excavator/frameworks/` 下有名为 `<id>.md` 的附录，配置的 `promptSnippetPath` SHALL 指向它。
- 该目录里每个附录（`README.md` 除外）SHALL 对应一个已注册的配置。
- 两个方向都由测试强制。

Full 模式的分析派发 SHALL 以图头 `project.frameworks` 作为「检出的框架」：
- 结构分析（architecture）按其中每个 id 注入 `frameworks/<id>.md` 的全文；
- 节点语义生成（file-analyzer）的派发提示 SHALL 列出这些 id，供其自读附录。
- 某个 id 没有附录时静默跳过，MUST NOT 据框架名自行重建约定。

#### Scenario: 缺附录的新框架被测试拦下
- **WHEN** 注册了一个 id 为 `foo` 的框架配置，但 `frameworks/foo.md` 不存在
- **THEN** 契约测试失败

#### Scenario: 节点语义派发告知检出框架
- **WHEN** 图头 `project.frameworks` 为 `["javaee", "jsf"]`，Full 模式派发节点语义生成
- **THEN** 派发提示列出 `javaee` 与 `jsf`，file-analyzer 读取 `frameworks/javaee.md` 与 `frameworks/jsf.md`

#### Scenario: 结构分析按 id 注入附录
- **WHEN** 图头 `project.frameworks` 为 `["spring"]`
- **THEN** 结构分析的提示包含 `frameworks/spring.md` 的全文
