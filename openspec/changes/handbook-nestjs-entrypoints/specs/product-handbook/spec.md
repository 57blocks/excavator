## ADDED Requirements

### Requirement: NestJS 的入口候选

项目的某个 `package.json` 依赖 `@nestjs/core` 时，候选 SHALL 包含每一行 `@Get(`、`@Post(`、`@Put(`、`@Patch(`、`@Delete(`、`@All(`、`@Options(` 或 `@Head(` 装饰器，种类为路由。依赖 `@nestjs/schedule` 时，`@Cron(`、`@Interval(`、`@Timeout(` SHALL 成为种类为定时任务的候选；依赖 `@nestjs/event-emitter` 时，`@OnEvent(` SHALL 成为种类为定时任务的候选。`@Controller(` 行 SHALL NOT 成为候选。

#### Scenario: 控制器的处理函数各是一个候选

- **WHEN** 项目依赖 `@nestjs/core`，一个控制器有 `@Controller('orders')`、一个 `@Get()` 与一个 `@Post()`
- **THEN** 候选有两个路由，`@Controller` 那一行不是候选

#### Scenario: 没有依赖就不认

- **WHEN** 项目没有任何 `package.json` 依赖 `@nestjs/core`
- **THEN** `@Get(` 行不是候选

### Requirement: 路由表文件不以 router 命名

路由对象 `path:` 与 `<Route>` 元素 SHALL 在路径含 `rout` 的文件里成为候选，不限于含 `router` 的文件；路径不含 `rout` 的文件里的 `path:` SHALL NOT 成为候选。

#### Scenario: route-manifest 里的路由

- **WHEN** 项目依赖 `react-router-dom`，`src/routes/route-manifest.ts` 有 3 个 `path:` 对象
- **THEN** 候选有这 3 个页面
