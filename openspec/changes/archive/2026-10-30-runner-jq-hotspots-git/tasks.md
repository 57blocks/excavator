## 1. hotspots 放行属主不同的仓库

- [x] 1.1 `history.mjs` 发现仓库的调用以命令级配置把项目根的真实路径登记为可信
- [x] 1.2 测试：属主不同（`GIT_TEST_ASSUME_DIFFERENT_OWNER=1`）时计数与属主相同时一致，真实路径与符号链接路径各一例；修复前这两例失败

## 2. 镜像与自检

- [x] 2.1 `Dockerfile` 安装 `jq`
- [x] 2.2 自检新增 `jq` 与 `hotspots-git` 两项
- [x] 2.3 `docs/deploy.md` 的自检项数与检查清单同步

## 3. 验证

- [x] 3.1 `tests/skill/excavator/test_hotspots.test.mjs` 与 `tests/deploy` 通过，`node scripts/check-refs.mjs` 通过
- [x] 3.2 本地构建镜像，与修复前的镜像对比：仓库归 root、容器用户 10001 时 hotspots 与 `jq` 的结果
- [x] 3.3 修复后的镜像自检 14 项全过
