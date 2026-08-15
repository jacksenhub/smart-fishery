---
kind: dependency_management
name: 基于 npm Workspaces 的多包依赖管理（含锁定文件与 Electron 构建）
category: dependency_management
scope:
    - '**'
source_files:
    - fishery-digital-twin-platform/package.json
    - fishery-digital-twin-platform/package-lock.json
    - fishery-digital-twin-platform/.nvmrc
    - fishery-digital-twin-platform/apps/backend/package.json
    - fishery-digital-twin-platform/apps/frontend/package.json
    - fishery-digital-twin-platform/packages/shared/package.json
    - .github/workflows/ci.yml
---

## 1. 使用的系统/工具

- **包管理器**：npm（通过根 `package.json` 的 `packageManager: "npm@11.16.0"` 指定版本，配合 `.nvmrc` 中的 Node.js `22.20.0` 保证环境一致）。
- **Monorepo 结构**：使用 npm Workspaces，根 `package.json` 中声明 `workspaces: ["apps/*", "packages/*"]`，将 `apps/backend`、`apps/frontend`、`packages/shared` 等子包纳入统一依赖图。
- **锁定文件**：根目录存在 `package-lock.json`，且 GitHub Actions CI (`ci.yml`) 通过 `cache-dependency-path: fishery-digital-twin-platform/package-lock.json` 缓存该锁定文件，确保安装可重现。
- **私有包**：`@fishery/shared` 作为内部共享包，由 `apps/backend` 和 `apps/frontend` 以本地 workspace 引用方式 `"@fishery/shared": "0.1.0"` 消费，无需发布到 npm registry。
- **Electron 打包**：根 `package.json` 的 `build` 字段配置 electron-builder，并通过 `allowScripts` 显式允许 `electron@43.3.0` 与 `esbuild@0.28.1` 运行原生脚本。

## 2. 关键文件

- `fishery-digital-twin-platform/package.json` — 根工作区入口，声明 workspaces、顶层 scripts、`overrides`、Electron 构建配置。
- `fishery-digital-twin-platform/package-lock.json` — 全仓库锁定的依赖树，CI 缓存路径指向此文件。
- `fishery-digital-twin-platform/.nvmrc` — 固定 Node.js 版本为 `22.20.0`。
- `fishery-digital-twin-platform/apps/backend/package.json` — 后端 Express + TypeScript 依赖。
- `fishery-digital-twin-platform/apps/frontend/package.json` — Next.js + React + Three.js + TensorFlow 前端依赖。
- `fishery-digital-twin-platform/packages/shared/package.json` — 内部共享库，仅依赖 TypeScript。
- `.github/workflows/ci.yml` — CI 中缓存 `package-lock.json` 并执行构建/测试。

## 3. 架构与约定

- **分层 monorepo**：`apps/*` 是独立应用（backend、frontend、desktop），`packages/*` 是跨应用共享代码。共享包通过 workspace 协议解析，不经过 npm registry。
- **Node 版本约束**：根 `engines.node` 限制 `>=22.20 <25`，`.nvmrc` 固定 `22.20.0`，两者共同约束开发/CI 环境。
- **React 版本强制统一**：根 `overrides.react` 与 `overrides.react-dom` 均设为 `19.2.8`，防止子包因语义化版本范围拉取不同版本的 React。
- **构建脚本编排**：根 `scripts.build` 按顺序 `packages/shared → apps/backend → apps/frontend` 构建；`scripts.dev` 用 `concurrently` 同时启动 backend 与 frontend。
- **桌面端打包**：`scripts.desktop:build` 先执行根 build，再调用 `scripts/prepare-desktop.mjs` 生成 runtime，最后用 `electron-builder --win nsis --x64` 输出安装包至 `release/`。
- **无 vendoring**：所有第三方依赖通过 npm 从 `registry.npmjs.org` 下载，`node_modules` 位于根与工作区目录下，未见 vendor/ 或 git-submodule 形式的源码级锁定。

## 4. 约定与约束

- **依赖声明位置**：每个子包的运行时依赖写在其自身的 `dependencies`，构建/类型/测试工具写在各自的 `devDependencies`；根目录仅保留跨包共用的工具（concurrently、electron、electron-builder、esbuild）以及用于覆盖的 react/react-dom。
- **内部包版本同步**：`@fishery/shared` 在根与子包中均为 `0.1.0`，当前通过 workspace 解析，若未来发布到私有 registry，版本号需保持一致。
- **CI 可重现性**：CI 缓存 `package-lock.json`，因此提交变更时必须更新锁定文件以保证安装结果一致。
- **原生模块脚本白名单**：Electron 安全策略下，只有 `allowScripts` 中列出的包（`electron@43.3.0`、`esbuild@0.28.1`）允许在安装时执行原生脚本，新增带 postinstall 的原生依赖需在此处显式放开。
- **未发现的约束**：仓库中未发现 `.npmrc`、私有 registry 配置、`GOFLAGS`/`go.mod` 等 Go 相关依赖管理文件；固件部分（ESP32）使用 Arduino IDE 工程，不在本仓库内做包管理。
