## ADDED Requirements

### Requirement: 功能写完前不进入后面的阶段

排序、对策、专题与大纲阶段的第一条命令 SHALL 在本次运行的功能阶段开始过、而本次的功能（`--features` 给出的，不给时是全部功能）里还有功能单元或问题单元没写完（`planned`、`dispatched`，或 `failed` 且尝试不到 2 次）时退出 1，列出这些单元，并给出回到功能阶段的 `Next:` 行。功能阶段从没开始过时 SHALL 照旧运行。功能阶段的提示词 SHALL 要求为列出的每个功能派发，不为给后面的阶段留预算而少写。

#### Scenario: 功能没写完

- **WHEN** 输出目录里有 27 个功能 `checked`、41 个功能 `planned`，运行 `priority-items`
- **THEN** 退出 1，列出那 41 个功能，并有一行以 `Next: go back to Phase 4` 开头

#### Scenario: 只跑后面的阶段

- **WHEN** 输出目录里没有任何功能单元或问题单元尝试过，运行 `topic-lanes`
- **THEN** 与改动前的行为相同

#### Scenario: 失败的终态

- **WHEN** 其余功能都已 `checked`，一个功能 `failed` 且尝试了 2 次
- **THEN** 不拦

### Requirement: 词表不收单字的非 ASCII 词

固定文字检查 SHALL 拒绝建议词表与范围词表里只有一个字符、且含 ASCII 以外字符的词，并说明要写两个字符以上的词。

#### Scenario: 中文单字

- **WHEN** 译好的建议词表含「应」
- **THEN** `check-ui` 退出 1，指出这个词

#### Scenario: 两个字的词

- **WHEN** 译好的建议词表含「应该」而不含单字词
- **THEN** 这一项不出问题
