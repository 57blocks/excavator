## Context

hotspots 的历史读取设置 `GIT_CONFIG_GLOBAL=/dev/null` 和 `GIT_CONFIG_NOSYSTEM=1`，并删掉继承来的命令级配置，保证结果只由 HEAD 决定。git 的可信目录（`safe.directory`）只认系统级、用户级和命令级配置，所以镜像在系统级登记的 `*` 对 hotspots 不可见。

## Decisions

### D1 只在发现仓库的那一次调用里放行，按真实路径放行

`git rev-parse --absolute-git-dir` 是唯一一次以工作区为当前目录的调用，可信检查发生在这里；之后的读取都用明确的 git 目录和空工作区。这一次调用通过 `GIT_CONFIG_COUNT=1`、`GIT_CONFIG_KEY_0=safe.directory`、`GIT_CONFIG_VALUE_0=<项目根的真实路径>` 放行。

- 不用 `*`：只放行用户点名分析的这一个仓库，其余仓库的属主检查照旧。
- 不重新打开系统级配置：那会让机器配置重新影响结果，违背「只由 HEAD 决定」。
- 用真实路径：git 比较的是解析过符号链接的路径，给符号链接路径会对不上。
- 项目根必须是工作区根（是子目录时脚本本来就以 `inside-repository` 拒绝），所以放行的路径就是 git 检查的那个工作区根。

### D2 自检按调用路径检查，不按配置值检查

原有的 `safe-directory` 检查只确认系统配置里有 `*`，配置在而调用路径看不到它时照样通过。新增的 `hotspots-git` 检查直接运行 hotspots 脚本。git 的 `GIT_TEST_ASSUME_DIFFERENT_OWNER=1` 让临时仓库被当作属主不同，不需要 root 或 chown。

## Oracle

- 单元测试：设 `GIT_TEST_ASSUME_DIFFERENT_OWNER=1` 运行 hotspots，得到的计数与不设时相同；修复前同一测试以 `dubious ownership` 失败。真实路径和符号链接路径各一例。
- 镜像对比：仓库以 root 克隆、容器用户 10001。修复前的镜像 hotspots 退出 1 且没有 `jq`；修复后的镜像退出 0、写出 `hotspots.json`，`jq` 在 PATH 上。
- 修复后的镜像自检 14 项全过。
