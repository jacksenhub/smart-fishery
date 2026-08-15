---
kind: frontend_style
name: 基于 Tailwind CSS 3 + Next.js App Router 的深海主题前端样式体系
category: frontend_style
scope:
    - '**'
source_files:
    - fishery-digital-twin-platform/apps/frontend/tailwind.config.mjs
    - fishery-digital-twin-platform/apps/frontend/postcss.config.mjs
    - fishery-digital-twin-platform/apps/frontend/src/app/globals.css
    - fishery-digital-twin-platform/apps/frontend/package.json
    - fishery-digital-twin-platform/apps/frontend/src/components/dashboard/DashboardPrimitives.tsx
---

## 1. 系统/技术栈
- 框架：Next.js 16（App Router），开发模式支持 Webpack 与 Turbopack。
- CSS 方案：Tailwind CSS 3.4，通过 PostCSS 注入 `@tailwind base/components/utilities`；使用 `autoprefixer` 做浏览器前缀兼容。
- 构建集成：`postcss.config.mjs` 直接导入解析后的 `tailwind.config.mjs` 对象，避免在 Turbopack worker 中重复加载 ESM 配置。
- 第三方 UI：无外部 UI 组件库（如 shadcn、AntD），仅自研少量基础组件（`src/components/ui/StatusPill.tsx`）；图标使用 `lucide-react`；地图用 Leaflet（`react-leaflet`）；图表用 Recharts；3D 用 Three.js / React Three Fiber。

## 2. 关键文件
- `apps/frontend/tailwind.config.mjs`：主题扩展定义（颜色、阴影、背景图）。
- `apps/frontend/postcss.config.mjs`：PostCSS/Tailwind/Autoprefixer 管线。
- `apps/frontend/src/app/globals.css`：全局样式入口，包含 Leaflet 覆盖、滚动条、滑块、以及大量纯 CSS 动画装饰（entry-harbor、entry-sonar、entry-voyage 等）。
- `apps/frontend/package.json`：声明 Tailwind、Autoprefixer、Leaflet、Recharts、Framer Motion、Lucide 等依赖。
- `apps/frontend/src/components/dashboard/DashboardPrimitives.tsx`：页面级卡片/标题等基础布局原语，集中体现 Tailwind 类名风格。
- `apps/frontend/src/app/layout.tsx`：应用根布局（引入 `globals.css`）。

## 3. 架构与设计约定
### 设计令牌（Design Tokens）
所有视觉变量集中在 `tailwind.config.mjs` 的 `theme.extend` 中，形成一套“海洋/港口”主题色板：
- `app.{bg,panel,subtle,line}`：页面背景、面板白底、次级背景、分割线。
- `ink.{900,700,500}`：文字层级（深墨→浅墨）。
- `harbor.{600,500,100,50}`：品牌主色（青蓝）及其明度阶梯。
- `mist.{50,100,200,300}`：中性灰阶。
- `sage.500/100`、`sand.500/100`：辅助强调色（绿色/沙色）。
- `ocean.{950..800}`：深色背景梯度。
- `cyanTech`、`aqua`：高亮科技色。
- 自定义 `boxShadow.soft/panel/glow` 与 `backgroundImage.deepsea` 提供统一的卡片投影与深海渐变背景。

### 全局样式策略
- `globals.css` 通过 `@import "leaflet/dist/leaflet.css"` 引入地图样式，并覆盖 `.leaflet-container`、`.leaflet-control-attribution` 使其融入主题。
- 使用 `:root { color-scheme: light; }` 固定浅色模式。
- 为 `<html>`、`<body>` 设置最小宽度 320px、平滑滚动、统一字体栈（Inter → SF Pro → Segoe UI → Microsoft YaHei → system-ui）。
- 自定义滚动条 `.soft-scrollbar`、范围滑块 `.servo-range`（含 webkit/moz 双端伪元素）。
- 大量纯 CSS 动画装饰：`entry-harbor`（浮船+波浪）、`entry-sonar`（雷达扫描+脉冲）、`entry-voyage`（地球航线+进度条），均配合 `@keyframes` 与 `prefers-reduced-motion` 媒体查询禁用动画以尊重可访问性。

### 组件层样式组织
- 页面/业务组件位于 `src/components/dashboard/*`，全部使用 Tailwind 原子类组合出卡片、栅格、间距、排版。
- 通用小 UI 放在 `src/components/ui/`（目前仅 `StatusPill.tsx`），遵循同一套 token。
- 没有独立的 CSS Modules / SCSS / CSS-in-JS；样式完全由 Tailwind 原子类 + 少量全局 CSS 构成。

### 响应式策略
- 基于 Tailwind 断点（`sm:`、`md:`、`lg:`）进行布局切换（如 dashboard loading 中的 `sm:flex-row`、`lg:border-r`）。
- 在 `globals.css` 中使用原生 `@media (max-width: 640px)` 对 entry 动画区域做尺寸适配。
- 使用 `clamp()`、`min(…vw, …px)` 实现流体字号与容器尺寸。

## 4. 约定与约束
- **颜色必须来自 Tailwind 扩展 token**：组件中直接使用 `bg-app-bg`、`text-ink-900`、`border-app-line`、`shadow-soft`、`bg-deepsea` 等，不手写十六进制色值。
- **卡片/面板统一圆角与边框**：普遍使用 `rounded-3xl` / `rounded-[26px]`、`border border-app-line`、`bg-white`、`shadow-sm` 或 `shadow-soft`，保持 Dashboard 区块一致性。
- **间距与排版**：使用 Tailwind spacing scale（`p-5`、`gap-3`、`space-y-3`、`mt-3`、`mx-auto`）与语义化字号（`text-xs/sm/base/lg/2xl/3xl`）。
- **Leaflet 样式覆盖**：所有地图容器需包裹在 `.leaflet-container`，并通过 `globals.css` 中的规则继承主题色。
- **动画可访问性**：所有自定义 `@keyframes` 均在 `@media (prefers-reduced-motion: reduce)` 中被禁用，确保低动效偏好用户不受影响。
- **PostCSS 配置方式**：必须在 `postcss.config.mjs` 中以对象形式传入已解析的 Tailwind 配置，禁止只传路径字符串，以避免 Turbopack worker 下配置未定义问题。
- **内容扫描范围**：Tailwind `content` 指向 `src/**/*.{ts,tsx}`，确保新组件自动被扫描生成样式。

综上，该工程的前端样式体系以 **Tailwind CSS 3 原子类 + 集中式 design tokens + 少量全局 CSS 动画** 为核心，围绕“深海/港口”主题色板构建一致的仪表盘界面，并通过 Next.js App Router 的 `globals.css` 作为全局样式入口。