## 背景

入口目录 `entrypoint-catalog.json` 每组有扩展名、可选的 `detect`（清单文件里的依赖）和若干正则，正则按行匹配，每行一个候选，种类取 `route`、`page`、`job`、`main`。

## 决定

### D1 三个新组，用自己的检测规则

- 构建文件检测器不报 NestJS，所以每组写自己的 `detect`：`package.json` 里的 `@nestjs/core`、`@nestjs/schedule`、`@nestjs/event-emitter`。
- 扩展名与 express 组相同。
- 正则：
  - 路由：`@(?:Get|Post|Put|Patch|Delete|All|Options|Head)\(`；
  - 定时：`@(?:Cron|Interval|Timeout)\(`；
  - 事件：`@OnEvent\(`。
- 事件监听记为 `job`：不新加种类。地图里 `job` 的意思是「不经用户操作、自动发生的工作」，事件监听属于这一类。新加种类要动地图、到达方式与页面，这一片不做。
- 不认 `@Controller(` 本身：它只是前缀，处理函数才是入口。
- 不认微服务的 `@MessagePattern(` 与 `@EventPattern(`：没有语料用到，不为可能用到的写规则。

### D2 路径提示放宽到 `rout`

- 提示的作用是挡住一般对象里的 `path:`（例如接口配置），所以不去掉，只放宽：`rout` 覆盖 `router`、`routes`、`route-manifest`、`routing`。
- `<Route` 元素同样用新提示。
- 剩余假设里的说明改成新提示。

## Oracle

- **O1 夹具测试**：
  - 一个 NestJS 夹具：有 `@nestjs/core`、`@nestjs/schedule`、`@nestjs/event-emitter` 依赖；有控制器（含 `@Controller('x')`）、定时任务与事件监听。候选数与种类完全等于夹具里处理函数的数目，`@Controller` 行不算；
  - 没有这些依赖的项目里，同样的装饰器不出候选；
  - 一个 `route-manifest.ts` 里的 `path:` 都成为候选，一个 `api-config.ts` 里的 `path:` 不成为候选；
  - 已有的 express、gin、react 测试不变。
- **O2 真实运行**：用这一片的代码对原项目重跑 `candidates`，NestJS 路由数等于 `grep` 数出的装饰器数，路由表的条目都在。
- **O3**：受影响测试、`typecheck`、`openspec validate --all --strict`、源码零非 ASCII、名字扫描。
