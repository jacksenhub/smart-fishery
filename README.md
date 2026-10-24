# 智慧渔业巡检船数字孪生与设备控制平台

面向船载巡检场景的综合项目，包含 ESP32 设备固件、后端设备管理、实时状态监控、三维船模、航线展示和视觉识别模块。

## 系统组成

- **ESP32 固件**：多设备通信、舵机控制、电机与推杆控制、GPS 数据采集和安全保护。
- **后端服务**：设备命令队列、状态持久化、GPS 状态、水质数据接口和 AI 分析接口。
- **Web 前端**：系统总览、三维船模、设备控制、航线、环境监测和设备日志。
- **桌面端**：基于 Electron 的本地运行版本。

## 设备链路

```text
Web / Desktop
      │
      ▼
Express API + Device Stores
      │  UDP discovery + HTTP commands/status
      ▼
ESP32 controller boards + GPS
      │
      ├── Servos
      ├── Brushed motor
      ├── Linear actuators
      └── GPS UART
```

ESP32 固件运行在 Arduino Core 3.3.11 上。设备通过 UDP 自动发现局域网后端，不依赖固定电脑 IP；命令和状态通过 HTTP 接口交换，并携带设备控制令牌。

## 当前实现范围

- 两块 MAKER-ESP32-PRO 控制板，共 7 路可用舵机；
- 有刷直流电机和电动推杆控制；
- GPS UART 接入及定位有效性判断；
- 舵机输入限幅、平滑移动和状态回传；
- 电机缓启动、死区、急停、命令超时和断网停机；
- 推杆运行时长、往返次数和冷却保护；
- 多设备 ID、独立命令队列和离线状态管理。

水质监测接口支持真实传感器、演示数据和离线占位数据，并在前端标明数据来源。未配置大模型密钥时，AI 分析使用本地基线逻辑。

SimpleFOC 双无刷推进固件目前作为扩展模块保留，默认关闭电机输出。

## 项目入口

- [项目说明与启动方式](fishery-digital-twin-platform/README.md)
- [硬件与固件说明](fishery-digital-twin-platform/docs/hardware-and-firmware.md)
- [ESP32 固件](fishery-digital-twin-platform/firmware/README.md)
- [现场运行手册](fishery-digital-twin-platform/docs/demo-runbook.md)
- [安全与网络配置](fishery-digital-twin-platform/docs/security-and-network.md)
- [验证与版本记录](fishery-digital-twin-platform/docs/validation-and-release-notes.md)

## 快速启动

```powershell
cd fishery-digital-twin-platform
npm install
npm run setup:local
npm run dev
```

默认地址：

```text
Web：http://localhost:3000
API：http://localhost:5000
```

固件依赖和全量编译检查：

```powershell
npm run firmware:setup
npm run firmware:check
```

## 安全说明

Wi-Fi 凭据、设备控制令牌和第三方 API 密钥仅保存在本机被忽略的配置文件中，不进入版本库。详细配置见[安全与网络配置](fishery-digital-twin-platform/docs/security-and-network.md)。
