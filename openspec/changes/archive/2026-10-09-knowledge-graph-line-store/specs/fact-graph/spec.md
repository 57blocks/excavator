## MODIFIED Requirements

### Requirement: canonical 事实不可被模型回写

`knowledge-graph.jsonl` 中的确定性节点身份、源码范围、结构边、coverage 与 gaps SHALL 只由确定性投影写入；任何模型输出 MUST NOT 通过 merge/annotate/publish 修改这些字段。无法映射到事实节点的模型输出 SHALL 记为 gap，MUST NOT 创建假锚点。

#### Scenario: 无法映射的模型输出记为 gap
- **WHEN** （后续切片中）某模型输出无法映射到任何事实节点
- **THEN** 记录为一条 semantic gap，而不是新建一个事实锚点

## ADDED Requirements

### Requirement: 图谱持久化不受单字符串上限约束且往返无损

图谱 SHALL 持久化为 `.excavator/knowledge-graph.jsonl`。第一行是文件头，带格式标识、全部根级标量字段与各类记录的计数；其后每行一条记录，一条记录只承载一个节点、一条边、一个分层、一个导览步骤、coverage 或一个缺口，因此单行长度与整图大小无关。写入与读取 MUST NOT 把整图放进单个字符串。

读回的内存图 SHALL 与写入前严格深度相等：记录顺序与原数组顺序一致；同一张图写两次逐字节相同。读取时 SHALL 校验文件头、记录数与记录类型；校验失败 SHALL 以具名错误失败并报告为无效产物，MUST NOT 返回部分图。

系统 MUST NOT 读取旧格式的 `knowledge-graph.json`。只剩旧文件时，读取方 SHALL 把图谱报告为缺失产物；发布新图谱时 SHALL 删除旧文件。

结构抽取结果 SHALL 以同样的按行方式持久化为 `intermediate/structure-all.jsonl`：一个文件头加每个被扫描文件一行。

#### Scenario: 往返严格相等
- **WHEN** 把一张图（含无 coverage/gaps 的旧形状、含分层与导览的 Full 形状）写出后再读回
- **THEN** 读回的图与原图严格深度相等，再写一次得到逐字节相同的文件

#### Scenario: 图谱总量超过单字符串上限
- **WHEN** 一个仓库的图谱若整体序列化会超过运行时单字符串上限
- **THEN** 持久化与读取仍然成功，文件中没有任何一行接近该上限

#### Scenario: 截断或损坏的图谱文件
- **WHEN** 图谱文件缺少文件头、实际记录数与文件头声明不符，或出现未知的记录类型
- **THEN** 读取以具名错误失败，读取方报告无效产物，不返回部分图

#### Scenario: 只剩旧格式的图谱文件
- **WHEN** 数据目录里只有旧的 `knowledge-graph.json`
- **THEN** 读取方把图谱视为缺失并以可见缺口报告，不解析旧文件；下一次成功发布删除该旧文件
