# 智慧渔业巡检船数字孪生与 AI 决策平台

面向海洋航行器制作大赛的智慧渔业巡检船平台。系统围绕 3D 船模展示、环境监测、AI 辅助分析、设备健康、航线规划、水上执行机构控制和操作日志展开。

## 当前功能

- 首页：展示“耕海一号”3D 船模，支持自动旋转、拖动、缩放和查看。
- 系统总览：展示平台状态和核心监测数据。
- 三维孪生：展示船模姿态、任务状态和演示级控制反馈。
- 环境监测：展示水温、浊度、pH、溶解氧、氨氮、电导率，并集成 AI 预测报告。
- 水上执行机构：控制两块 MAKER-ESP32-PRO 舵机板，共 8 路舵机。
- 航线规划：展示淡蓝色海域航线和模拟航迹。
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

开发调试：

```powershell
cd E:\Users\OneDrive\Desktop\UIsys\fishery-digital-twin-platform
npm run dev
```

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

## 检查 WiFi 和电脑 IP

ESP32 不能使用 `localhost` 访问电脑后端，必须使用电脑当前 WiFi 的 IPv4 地址。

查看电脑 IPv4：

```powershell
ipconfig | findstr IPv4
```

优先看 `WLAN` 对应的 IPv4，例如：

```text
10.161.51.97
```

固件里需要与这个地址一致：

```cpp
const char* SERVER_HOST = "10.161.51.97";
const char* SERVER_BASE = "http://10.161.51.97:5000";
```

查看电脑保存过的 WiFi 名称：

```powershell
netsh wlan show profiles
```

查看某个 WiFi 的密码：

```powershell
netsh wlan show profile name="Xiaomi 17" key=clear
```

在输出中查看 `关键内容` 或 `Key Content`。不要在公开场合截图展示该信息。

## 安全说明

- `apps/backend/.env` 保存 DeepSeek 密钥，不要公开上传或发给别人。
- 固件里的 WiFi 密码和电脑 IP 只适合本机比赛演示使用，不要公开发布。
- 比赛现场建议使用手机热点或专用路由器，避免接入公共校园网。
- 后端会监听 `0.0.0.0:5000`，方便 ESP32 访问；同一局域网内其他设备理论上也能访问控制接口。
- Windows 防火墙需要允许 TCP 5000 入站，否则 ESP32 无法上报状态。

更详细说明见：

```text
docs/security-and-network.md
```

## 最终检查

交付或答辩前建议按清单检查：

```text
docs/final-checklist.md
```
