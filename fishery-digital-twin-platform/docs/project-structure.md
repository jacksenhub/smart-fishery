# 项目结构说明

## 根目录

```text
fishery-digital-twin-platform/
  apps/
  packages/
  firmware/
  docs/
  package.json
  README.md
```

## apps/frontend

前端网页项目，基于 Next.js、React、TypeScript、TailwindCSS、Three.js、React Three Fiber 和 Recharts。

主要页面路由：

```text
/                       首页 3D 船模展示
/dashboard              系统总览
/dashboard/twin         三维孪生
/dashboard/water        环境监测 + AI 预测报告
/dashboard/servos       水上执行机构
/dashboard/navigation   航线规划
/dashboard/health       设备健康
/dashboard/logs         操作日志
```

保留的兼容重定向：

```text
/dashboard/ai           自动跳转到 /dashboard/water
/dashboard/propulsion   自动跳转到 /dashboard/twin
```

核心文件：

```text
apps/frontend/src/components/dashboard/PlatformShell.tsx
```

控制平台外壳、侧边导航和顶部状态栏。

```text
apps/frontend/src/components/dashboard/DashboardPages.tsx
```

各个 Dashboard 页面主体内容。

```text
apps/frontend/src/components/three/BoatTwinScene.tsx
```

3D 船模渲染、自动旋转、手动交互和模型上色。

```text
apps/frontend/src/lib/api.ts
```

前端调用后端 API 的统一入口。

## apps/backend

后端服务，基于 Express。

```text
apps/backend/src/index.ts
```

注册全部 API 路由，监听 `0.0.0.0:5000`，供网页和 ESP32 访问。

```text
apps/backend/src/ai-service.ts
```

DeepSeek / 本地 AI 报告生成逻辑。

```text
apps/backend/src/servo-store.ts
```

两块舵机板的命令队列和状态存储。

```text
apps/backend/src/propulsion-store.ts
```

双无刷推进器的命令队列、状态存储和差速混控。当前页面入口已隐藏，仅保留后续扩展能力。

```text
apps/backend/src/mock-data.ts
```

水质、电池、导航和船舶状态的模拟数据。

## packages/shared

前后端共享类型定义，避免接口字段不一致。

```text
packages/shared/src/index.ts
```

包括水质、电池、导航、AI 报告、舵机、推进器和日志类型。

## firmware

当前推荐烧录入口：

```text
firmware/esp32/maker_esp32_pro_servo_temp_01
```

第一块 MAKER-ESP32-PRO，设备 ID 为 `servo-quad-01`，包含四路舵机和 M0 端口 37GB555 直流电机控制。

```text
firmware/esp32/maker_esp32_pro_four_servo_02
```

第二块 MAKER-ESP32-PRO，设备 ID 为 `servo-quad-02`，控制第 5-8 路舵机。

```text
firmware/esp32/esp32_simplefoc_dual_propulsion
```

ESP32 SimpleFOC 双无刷推进板，当前保留为扩展固件。

停用入口：

```text
firmware/esp32/maker_esp32_pro_four_servo
```

旧的 servo1 纯舵机固件已停用，请不要烧录。
