## ADDED Requirements

### Requirement: 默认目录规则误排的源码包由宿主 skill 找回

默认忽略规则里的目录规则（以 `/` 结尾，如 `build/`、`out/`、`target/`、`dist/`、`vendor/`、`obj/`、`coverage/`）只按目录名判定，SHALL 保持不变。运行时 MUST NOT 为它们加按内容判定的例外，也 MUST NOT 加项目专属的例外。

宿主 skill 的忽略规则预检 SHALL 在提议新排除规则的同时，找回被默认目录规则按名字误排的源码包。

**找候选**：在预检的基线扫描里，看被默认规则排除、原因是默认规则的条目，读其中文件开头的包声明。

**唯一依据**：某个文件自己的 `package`（或 `namespace`）声明包含该路径上被默认目录规则命中的每一个目录时，SHALL 把这个目录作为源码包，提议一条项目取反规则，只取反这一个目录路径。

**不算依据的**：目录名、源码扩展名、文件看起来是手写的，都 MUST NOT 单独作为依据。包声明只包含部分命中目录时（例如命中目录还有一个在包路径之外的 `target/`），MUST NOT 提议取反规则。

**审查找回的路径**：前后两份扫描比较时，SHALL 逐条审查改后新被选中的路径。
- 找回的文件不全属于提议的源码包时，SHALL 放弃这条取反规则；
- 一条取反规则不改变选择结果时，SHALL 放弃它。

**写入与报告**：通过审查的取反规则与其他获准规则一样写入根 `.excavatorignore` 并复核，报告时列出找回的路径与包声明证据。

敏感文件、归档与分析数据照旧不能被取反规则找回。

#### Scenario: 名为 out 的 Java 包被找回
- **WHEN** 仓库没有根 `.excavatorignore`，含 `webservice-holder/src/main/java/org/superbiz/ws/out/Calculator.java`，它声明 `package org.superbiz.ws.out;`，默认规则 `out/` 排除了它
- **THEN** 预检提议 `!webservice-holder/src/main/java/org/superbiz/ws/out/`，比较后新被选中的路径只有该目录里的文件；规则写入根 `.excavatorignore` 后，复核的选择结果与比较时相同

#### Scenario: 生成代码与第三方库不被找回
- **WHEN** `target/generated-sources/annotations/com/acme/Foo.java` 声明 `package com.acme;`，`vendor/org/lib/Bar.java` 声明 `package org.lib;`
- **THEN** 命中的 `target`、`vendor` 不在各自的包路径里，预检不为它们提议取反规则

#### Scenario: 运行时选择不变
- **WHEN** 没有项目规则与 CLI 规则，对同一份内容做选择
- **THEN** 选择结果与选择摘要与本变更之前相同；名为 `out` 的源码包只在项目规则取反后才被选中
