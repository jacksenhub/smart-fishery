---
kind: build_system
name: Monorepo 构建与桌面端打包体系（npm workspaces + Next.js/Express + Electron-builder）
category: build_system
scope:
    - '**'
source_files:
    - fishery-digital-twin-platform/package.json
    - fishery-digital-twin-platform/.nvmrc
    - .github/workflows/ci.yml
    - fishery-digital-twin-platform/scripts/preflight.ps1
    - fishery-digital-twin-platform/scripts/prepare-desktop.mjs
    - fishery-digital-twin-platform/scripts/configure-device-secrets.ps1
    - fishery-digital-twin-platform/scripts/configure-windows-network.ps1
    - fishery-digital-twin-platform/scripts/firmware-tooling.ps1
    - fishery-digital-twin-platform/apps/backend/package.json
    - fishery-digital-twin-platform/apps/frontend/package.json
    - fishery-digital-twin-platform/packages/shared/package.json
---

## 1. 使用的系统与工具

- **包管理与工作区**：根 `package.json` 通过 `workspaces: ["apps/*", "packages/*"]` 将 `apps/backend`、`apps/frontend`、`apps/desktop`、`packages/shared` 组织为 npm monorepo，所有子包版本统一为 `0.1.0`。
- **Node 版本锁定**：`.nvmrc` 固定为 `22.20.0`；CI 使用 `actions/setup-node@v4` 并通过 `node-version-file` 引用该文件，同时缓存 `package-lock.json`。
- **前端构建**：`apps/frontend` 使用 Next.js（`next build --webpack`），开发模式支持 webpack 与 Turbopack 两种入口。
- **后端构建**：`apps/backend` 使用 TypeScript + tsx 热重载（`tsx watch src/index.ts`），生产构建走 `tsc -p tsconfig.json`，运行产物位于 `dist/index.js`。
- **共享包**：`packages/shared` 仅做类型/常量共享，构建命令为 `tsc -p tsconfig.json`，输出 `dist/index.js` + `.d.ts`。
- **桌面端打包**：Electron 43 + electron-builder 26，根 `package.json` 的 `build` 字段配置 NSIS x64 安装包，产物输出到 `release/`，文件名模板 `渔博士-${version}-安装程序.${ext}`。
- **CI**：GitHub Actions (`github/workflows/ci.yml`) 在 `ubuntu-latest` 上执行 `npm ci → lint → test → typecheck → build`，工作目录为 `fishery-digital-twin-platform`。

## 2. 关键文件

| 文件 | 作用 |
|---|---|
| `fishery-digital-twin-platform/package.json` | 顶层 workspaces、脚本编排、electron-builder 配置、版本号 |
| `fishery-digital-twin-platform/.nvmrc` | 强制 Node 22.20.0 |
| `.github/workflows/ci.yml` | CI 流水线（lint/test/typecheck/build） |
| `scripts/preflight.ps1` | 启动前环境检查（Node 版本、端口占用、.env token、防火墙规则、设备在线状态） |
| `scripts/prepare-desktop.mjs` | 桌面端构建前置：复制 Next.js standalone 运行时 + esbuild 打包后端为 CJS，生成 `desktop-manifest.json` |
| `scripts/configure-device-secrets.ps1` | 生成/轮换 ESP32 与桌面端共享的 `UISYS_API_TOKEN` |
| `scripts/configure-windows-network.ps1` | 添加 Windows 防火墙规则（TCP 5000 / UDP 42110 私有网络放行） |
| `scripts/firmware-tooling.ps1` | ESP32 固件编译工具封装 |
| `scripts/clean-project.ps1` | 清理脚本 |
| `apps/backend/package.json` | 后端 dev/build/start/test/typecheck 脚本 |
| `apps/frontend/package.json` | Next.js dev/build/start/typecheck/lint 脚本 |
| `apps/desktop/main.cjs` | Electron 主进程入口（由 electron-builder 打包） |

## 3. 架构与约定

### 3.1 顶层脚本编排
根 `package.json` 的 scripts 是统一的构建入口：
- `npm run build` 顺序执行：`packages/shared` → `apps/backend` → `apps/frontend`，保证依赖先于消费者构建。
- `npm run dev` 用 `concurrently` 并行启动 backend + frontend，并带 `--kill-others-on-fail` 确保任一崩溃即退出。
- `npm run desktop:build` 串联 `build → desktop:prepare → electron-builder --win nsis --x64`，形成“全栈打包”单命令。
- `predev` / `prestart` 钩子自动调用 `preflight.ps1 -Mode before-start`，在启动前校验 Node 版本、端口占用、环境变量等。

### 3.2 桌面端打包流程
1. `npm run build` 产出 Next.js standalone 目录（`apps/frontend/.next/standalone`）和后端 `dist/`。
2. `scripts/prepare-desktop.mjs` 将 Next.js standalone 复制到 `apps/desktop/runtime/frontend/`，拷贝静态资源与 public 目录；用 esbuild 将 `apps/backend/src/index.ts` 打包为 `runtime/backend/index.cjs`（Node 平台、CJS、target node20）；最后写入 `runtime/desktop-manifest.json` 记录前端 server 与后端脚本相对路径。
3. `electron-builder` 只打包 `main.cjs`、`assets/**`、`runtime/**`、`package.json`，并将 `runtime/**` 从 asar 中 unpack，使内置 Node 服务可直接被 Electron 调用。
4. 产物命名含 `${version}`，当前版本集中在根 `package.json` 的 `version: "0.1.0"`。

### 3.3 安全与环境约定
- 所有敏感配置（ESP32 Wi-Fi 密码、`UISYS_API_TOKEN`）通过 `configure-device-secrets.ps1` 生成，且 `wifi_secrets.h` 被 `.gitignore` 保护；`preflight.ps1` 会校验 token 长度 ≥ 32 且前后端/固件一致。
- 后端默认监听 `0.0.0.0` 以便 ESP32 访问局域网；Windows 需通过 `setup:network` 添加防火墙规则放行 TCP 5000 与 UDP 42110。
- 健康检查：前端暴露 `/api/desktop-health`，后端暴露 `/api/health`，`preflight.ps1` 在 runtime 模式下主动探测这两个端点。

### 3.4 测试与类型检查
- 测试：`npm test` 委托给 `apps/backend`，使用 `tsx --test` 直接运行 `src/*.test.ts`。
- 类型检查：`npm run typecheck` 先 build shared，再分别对 backend/frontend 执行 `tsc --noEmit`。
- Lint：`npm run lint` 仅对 frontend 执行 ESLint（`eslint src --max-warnings=0`）。

## 4. 约束与规范

- **Node 版本**：必须满足 `>=22.20 <25`（根 `engines`）且推荐 `.nvmrc` 的 `22.20.0`；`preflight.ps1` 显式允许 22.20+、23.x、24.x。
- **构建顺序**：顶层 `build` 严格遵循 shared → backend → frontend 的依赖顺序，不可颠倒。
- **桌面端产物**：仅允许打包 `apps/desktop/main.cjs`、`assets/**`、`runtime/**`、`package.json`；`runtime/**` 必须 unpack from asar。
- **端口占用**：启动前必须空闲 3000 (frontend)、5000 (backend)、42110 (ESP32 UDP discovery)，否则 `preflight.ps1` 报错并 exit 1。
- **Token 一致性**：`apps/backend/.env`、桌面端 `APPDATA/<AppName>/backend.env`、四个 `firmware/esp32/*/wifi_secrets.h` 中的 `UISYS_API_TOKEN` 必须相同且长度 ≥ 32。
- **CI 门禁**：push main 或 PR 都会触发 `npm ci → lint → test → typecheck → build`，任何一步失败即中断流水线。
- **包管理器**：根 `packageManager` 指定 `npm@11.16.0`，配合 `package-lock.json` 锁定依赖树。
- **Firmware secrets 保护**：`*.h` 中的 `WIFI_SSID`/`WIFI_PASSWORD` 不得包含占位符（`replace-with` / `your-wifi`），否则 preflight 告警。