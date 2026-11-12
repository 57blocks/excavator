## Why

一次真实运行在一个 TypeScript 单仓项目上只列出 6 个入口候选，而它有：
- 31 个 NestJS 控制器，共 455 个路由处理函数；
- 64 个定时任务与事件监听；
- 一份前端路由表，60 条路由。

原因有两个：
- 入口目录里没有 NestJS：后端的装饰器路由、定时任务与事件监听一条也不认，构建文件检测器也不报这个框架，所以连「未覆盖的框架」都不显示；
- 前端路由对象（`path:`）只在路径含 `router` 的文件里找，这个项目的路由表文件名是 `route-manifest`。

候选是地图的全部输入，少了它们，后端功能整块缺席，而运行看起来是正常结束的。

## What Changes

- 入口目录加三组，各自用清单文件里的依赖检测：
  - `nestjs`（`@nestjs/core`）：`@Get(`、`@Post(`、`@Put(`、`@Patch(`、`@Delete(`、`@All(`、`@Options(`、`@Head(` 记为路由；
  - `nestjs-schedule`（`@nestjs/schedule`）：`@Cron(`、`@Interval(`、`@Timeout(` 记为定时任务；
  - `nestjs-event`（`@nestjs/event-emitter`）：`@OnEvent(` 记为定时任务一类（自动发生的工作）。
- 前端路由对象与 `<Route>` 的路径提示从 `router` 放宽到 `rout`：路径含 `router`、`routes`、`route-manifest` 的文件都算。剩余假设的说明随之改写。

## Capabilities

### Modified Capabilities

- `product-handbook`：入口候选认出 NestJS 的路由、定时任务与事件监听，以及不以 `router` 命名的路由表文件。

## Impact

- `skills/excavator-product-handbook/lib/entrypoint-catalog.json`、`lib/entrypoints.mjs`（剩余假设文字）。
- 已有运行的 `candidates.json` 不变；要用新候选须 `--fresh`。
