# 智慧渔业巡检船数字孪生与 AI 决策平台

面向海洋航行器制作大赛的智慧渔业巡检船平台。系统围绕 3D 船模展示、环境监测、AI 辅助分析、设备健康、航线规划、水上执行机构控制和操作日志展开。

## 当前功能

- 首页：展示“耕海一号”3D 船模，支持自动旋转、拖动、缩放和查看。
- 系统总览：展示平台状态和核心监测数据。
- 三维孪生：展示船模姿态、任务状态和演示级控制反馈。
- 环境监测：展示水温、浊度、pH、溶解氧、氨氮、电导率，并集成 AI 预测报告。
- 水上执行机构：控制两块 MAKER-ESP32-PRO 舵机板，共 8 路舵机。
- 航线规划：优先展示真实 WGS84 GPS 定位；无定位时明确标记参考航线，并支持离线底图。
- 设备健康：展示电池、电控、通信和传感器状态，异常时红色预警。
- 操作日志：记录后端、传感器、AI 和控制事件。

## 目录结构

```text
fishery-digital-twin-platform/
  apps/
    backend/       Express 后端、AI 接口、设备命令接口
    frontend/      Next.js 前端、3D 船模、图表、地图和控制页面
  packages/
    shared/        前后端共享 TypeScript 类型
  firmware/
    esp32/         ESP32 / MAKER-ESP32-PRO / SimpleFOC 固件
  docs/            项目结构、硬件接入、模型导入和最终检查文档
```

更详细的结构说明见：

```text
docs/project-structure.md
```

## 启动项目

首次复制到一台新 Windows 电脑后，安装 Node.js 22，再依次运行：

```powershell
npm install
npm run setup:local
npm run dev
```

`setup:local` 会在本机终端询问热点名称和密码：首次运行时生成控制令牌，以后重复运行默认保留原令牌；随后弹出 Windows 管理员确认，仅为“专用网络”开放 TCP 5000 和 UDP 42110。热点密码和令牌不会显示，也不会被 Git 跟踪。只有确认所有 ESP32 都会重新烧录时，才运行 `npm run setup:devices:rotate` 主动更换令牌。

如果热点和固件已经配置好，只需为桌面安装版补齐当前后端令牌，可运行 `npm run setup:desktop`；该命令不询问热点密码、不更换令牌，也不会打印秘密值。

初始化完成后，需要把实际使用的 ESP32 程序重新烧录一次。以后开发调试只需运行：

```powershell
npm run dev
```

服务运行后可执行一键诊断：

```powershell
npm run doctor
```

诊断会检查后端与固件令牌、WiFi 配置、端口、防火墙、前后端健康状态和开发板心跳，但不会输出任何密码或令牌。

默认地址：

```text
前端网页：http://localhost:3000
后端接口：http://localhost:5000
```

比赛展示或长时间运行建议使用生产模式：

```powershell
npm run build
npm run start
```

## DeepSeek 配置

后端支持真实 DeepSeek API。复制示例文件：

```powershell
copy apps\backend\.env.example apps\backend\.env
```

然后在 `apps/backend/.env` 中填写：

```text
DEEPSEEK_API_KEY=你的密钥
```

不配置密钥时，环境监测页中的 AI 报告会使用本地预测逻辑生成演示报告。

## 固件烧录入口

新电脑先安装 Arduino IDE 2.x，再运行：

```powershell
npm run firmware:setup
npm run firmware:check
```

该流程使用已验证版本：ESP32 Arduino Core 3.3.11、ESP32Servo 3.2.1、TinyGPSPlus 1.0.3、Simple FOC 2.4.0。

### 第一块舵机板：servo1 + 温度传感器

```text
firmware/esp32/maker_esp32_pro_servo_temp_01/maker_esp32_pro_servo_temp_01.ino
```

设备 ID：

```text
servo-quad-01
```

### 第二块舵机板：servo2

```text
firmware/esp32/maker_esp32_pro_four_servo_02/maker_esp32_pro_four_servo_02.ino
```

设备 ID：

```text
servo-quad-02
```

### 双无刷推进板

```text
firmware/esp32/esp32_simplefoc_dual_propulsion/esp32_simplefoc_dual_propulsion.ino
```

设备 ID：

```text
mks-foc-dual-01
```

注意：`firmware/esp32/maker_esp32_pro_four_servo` 是旧的 servo1 纯舵机入口，已经停用，请不要烧录。

## WiFi 与后端自动发现

ESP32 不再写死电脑 IP。连接同一可信热点后，固件会通过 UDP 自动发现当前电脑后端：

```text
ESP32 广播 UISYS_DISCOVER_V1 -> 电脑 UDP 42110
电脑回复/主动广播 UISYS_BACKEND_V1|5000
ESP32 采用回复数据包的来源 IP -> 继续访问 HTTP 5000
```

第一块板监听 UDP 42111，第二块板监听 42112，独立 GPS 监听 42113，双无刷推进板监听 42114。电脑 IP、WiFi 或后端连接发生变化后，固件会清除旧地址并重新发现，不需要再次修改固件里的服务器 IP。

排查网络时仍可查看电脑 WLAN IPv4：

```powershell
ipconfig | findstr IPv4
```

电脑与两块开发板必须连接同一个热点，并且热点不能开启客户端隔离。

查看电脑保存过的 WiFi 名称：

```powershell
netsh wlan show profiles
```

推荐在项目根目录运行 `npm run setup:devices`，一次填写热点信息，它会为后端和全部有效固件生成一致的本机配置。各固件目录仍保留 `wifi_secrets.example.h` 供手动配置；生成的 `wifi_secrets.h` 不会被 Git 跟踪。

运行 `setup:devices` 修改的是待烧录源码，不会远程更新板内固件。热点或令牌确实发生变化后，必须重新烧录受影响的 ESP32。

## 安全说明

- `apps/backend/.env` 保存 DeepSeek 密钥，不要公开上传或发给别人。
- 固件和后端使用同一个控制令牌；局域网设备请求缺少令牌时会被拒绝。
- 比赛现场建议使用手机热点或专用路由器，避免接入公共校园网。
- 后端监听 `0.0.0.0:5000` 供 ESP32 访问，但 CORS 默认限制到本机前端，局域网控制接口要求令牌。
- Windows 防火墙需要允许 TCP 5000 和 UDP 42110 入站，否则 ESP32 可能无法上报状态或自动发现后端。运行 `npm run setup:network` 可自动完成该配置，规则仅作用于“专用网络”。

更详细说明见：

```text
docs/security-and-network.md
```

比赛现场启动与故障恢复见 `docs/demo-runbook.md`。

## 最终检查

交付或答辩前建议按清单检查：

```text
docs/final-checklist.md
```

日常质量检查：

```powershell
npm run lint
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

本次系统审查与修复记录见 `docs/code-review-2026-08-08.md`。
