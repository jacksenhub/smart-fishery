---
kind: error_handling
name: 后端 Express 统一错误响应与前端集中式 fetch 异常处理
category: error_handling
scope:
    - '**'
source_files:
    - fishery-digital-twin-platform/apps/backend/src/index.ts
    - fishery-digital-twin-platform/apps/backend/src/ai-service.ts
    - fishery-digital-twin-platform/apps/backend/src/gps-store.ts
    - fishery-digital-twin-platform/apps/backend/src/persistence.ts
    - fishery-digital-twin-platform/apps/frontend/src/lib/api.ts
---

## 1. 整体方案

该仓库是一个多端工程（Next.js 前端 + Express 后端 + Electron 桌面端 + ESP32 固件），错误处理主要集中在 **后端 Express 服务** 和 **前端 Next.js 的 API 客户端** 两个层面，没有统一的错误类型库或全局中间件框架。

- 后端：Express 应用，使用 `try/catch` 包裹每个写操作路由，配合一个全局错误处理中间件；通过 `appendLog` 将错误写入内存日志并持久化到 `data/platform-state.json`。
- 前端：封装统一的 `fetchJson` 函数，所有 API 调用都经过它，非 `response.ok` 时直接 `throw new Error(...)`，由调用方组件自行 try/catch。
- 固件层（ESP32）：代码中未发现专门的错误类型定义，仅通过串口/HTTP 上报状态，不在本仓库范围内做深入分析。

## 2. 关键文件与位置

| 层级 | 文件 | 职责 |
|---|---|---|
| 后端入口 | `apps/backend/src/index.ts` | 注册 CORS、鉴权中间件、全部 HTTP 路由、全局错误中间件、UDP 发现服务、进程信号处理 |
| AI 服务 | `apps/backend/src/ai-service.ts` | 调用 DeepSeek API，失败时抛错并由上层捕获 |
| GPS Store | `apps/backend/src/gps-store.ts` | 参数校验失败抛 `Error`（如坐标系统非法） |
| 持久化 | `apps/backend/src/persistence.ts` | 读写磁盘状态，IO 异常仅 `console.error` 不中断流程 |
| 前端 API 客户端 | `apps/frontend/src/lib/api.ts` | 统一 `fetchJson`，自动附加 `X-UISYS-Token`，非 2xx 抛错 |

## 3. 架构与约定

### 3.1 后端 Express 错误模型

- **参数校验失败**：在路由内通过辅助函数 `readPort`、`readBoundedOptionalNumber` 等直接 `throw new Error(message)`，消息语义明确（例如 `${key} must be a number from ${minimum} to ${maximum}`、`coordinate_system must be WGS84`）。
- **业务写入路由**：`/api/gps/status`、`/api/data`、`/api/servos`、`/api/propulsion`、`/api/twin/simulate` 等写接口均用 `try/catch` 包裹，捕获后统一返回 `{ error: message }` JSON，HTTP 状态码为 `400`。
- **外部依赖失败**：AI 报告生成 `/api/ai/report` 捕获 `generateDecisionReport` 抛出的错误，记录到 `systemLogs`（level=`error`，source=`ai`），返回 `503` + `{ error, log }`。
- **CORS 拒绝**：CORS 配置中未允许的 origin 通过 `callback(new Error(...))` 交给 Express 默认机制，最终被全局错误中间件转为 `403`。
- **全局错误中间件**：位于 `index.ts` 末尾的 `(error, req, res, next) => ...`，对包含 `not allowed by CORS` 的消息返回 `403`，其余一律 `500` + `{ error: error.message }`。
- **UDP 发现服务错误**：`discoveryServer.on("error", ...)` 中区分 `EADDRINUSE` / `EACCES`，设置 `process.exitCode = 1` 并立即退出；其他错误仅 `console.error`。
- **HTTP 启动错误**：`httpServer.on("error", ...)` 同样区分端口占用/权限错误并退出进程。
- **优雅关闭**：`SIGINT` / `SIGTERM` 触发 `shutdown`，先 `flushPersistedState()` 再关闭 UDP socket 与 HTTP server，超时强制 `process.exit(1)`。

### 3.2 前端集中式 fetch 异常

`apps/frontend/src/lib/api.ts` 中的 `fetchJson` 是唯一的网络入口：
- 统一设置 `Content-Type`、可选 `X-UISYS-Token`、`AbortSignal.timeout(5000)`。
- 若 `!response.ok`，读取 body text 并 `throw new Error(detail || 'API returned ${status}')`。
- 成功路径返回解析后的 JSON。

因此前端各组件/页面调用 API 时，需要自行 `try/catch` 处理网络错误、超时、服务端返回的业务错误。仓库中没有发现统一的错误边界组件或全局 toast 提示封装。

### 3.3 持久化层的容错

`persistence.ts` 采用“尽力而为”策略：加载失败打印错误并返回 `null`，保存失败仅 `console.error`，不会阻断主业务流程，保证平台在磁盘不可用时仍可运行。

## 4. 观察到的约定与约束

1. **参数校验优先抛错**：所有数值范围、枚举值校验集中在 `index.ts` 的辅助函数中，通过抛出 `Error` 让调用方 catch 并转成 `400` JSON，避免分散的 if-return 分支。
2. **写操作路由必须 try/catch**：所有修改状态的 POST 路由都显式包裹 try/catch，并记录 `appendLog`，形成“请求 → 日志 → 持久化”的闭环。
3. **错误响应体格式统一**：后端错误响应统一为 `{ error: string }`，部分场景附带 `{ log }`（如 AI 报告失败）。
4. **鉴权失败按状态码区分**：未配置 `UISYS_API_TOKEN` 返回 `503`，token 缺失或不匹配返回 `401`，CORS 拒绝返回 `403`，业务参数错误返回 `400`，限流返回 `429`。
5. **前端无全局错误拦截**：所有网络异常通过 `fetchJson` 抛出，调用处需自行处理；没有发现 React Error Boundary 或全局 toast 封装。
6. **外部依赖降级**：DeepSeek API 未配置时回退到本地 `localReport`；磁盘持久化失败不影响运行时；GPS 数据缺失时使用 mock 导航。
7. **进程级错误即退出**：端口占用、权限不足等启动期致命错误通过 `process.exit(1)` 终止进程，便于容器/守护进程重启。

## 5. 缺失与改进点

- 没有自定义错误类（如 `ValidationError`、`ServiceUnavailableError`），所有错误都是裸 `Error`，无法区分错误类别。
- 前端缺少统一的错误展示层（toast、错误页、重试按钮），错误处理分散在各组件中。
- 没有全局的 HTTP 错误码映射表，状态码散落在各路由中，新增接口容易不一致。
- 日志与错误耦合在业务逻辑中（`appendLog` 在每个路由内调用），尚未抽象为独立模块。
