# 硬件与固件说明

## 当前硬件

- 第一块 MAKER-ESP32-PRO：四路舵机控制 + M0 端口 37GB555 直流电机。
- 第二块 MAKER-ESP32-PRO：四路舵机控制。
- ESP32 SimpleFOC 双路无刷推进板：保留为后续推进系统扩展。

## 当前烧录文件

### servo1：第一块舵机板 + 直流电机

```text
firmware/esp32/maker_esp32_pro_servo_temp_01/maker_esp32_pro_servo_temp_01.ino
```

设备 ID：

```text
舵机：servo-quad-01
直流电机：maker-esp32-pro-dc-01
```

功能：

- 控制第 1-4 路舵机。
- 上报舵机状态到 `/api/servos/status`。
- 从 `/api/device/commands?device_id=servo-quad-01` 读取网页命令。
- 使用 GPIO27 / GPIO13 驱动 M0 端口的 37GB555 有刷直流电机。
- 从 `/api/propulsion/commands?device_id=maker-esp32-pro-dc-01` 读取直流电机命令。
- 向 `/api/propulsion/status` 上报直流电机状态。

### servo2：第二块舵机板

```text
firmware/esp32/maker_esp32_pro_four_servo_02/maker_esp32_pro_four_servo_02.ino
```

设备 ID：

```text
servo-quad-02
```

功能：

- 控制第 5-8 路舵机。
- 上报舵机状态到 `/api/servos/status`。
- 从 `/api/device/commands?device_id=servo-quad-02` 读取网页命令。

### 已停用旧入口

```text
firmware/esp32/maker_esp32_pro_four_servo/maker_esp32_pro_four_servo.ino
```

这个文件是旧的 servo1 纯舵机版本，已经停用。第一块板现在请统一烧录 `maker_esp32_pro_servo_temp_01.ino`。

## 舵机接口

MAKER-ESP32-PRO 自带 4 个舵机接口：

```text
Servo 1 -> GPIO25
Servo 2 -> GPIO26
Servo 3 -> GPIO32
Servo 4 -> GPIO33
```

两块板的引脚相同，但通过不同的 `DEVICE_ID` 区分：

```text
第一块板：servo-quad-01
第二块板：servo-quad-02
```

## 37GB555 直流电机接线

```text
电机两根动力线 -> M0 电机输出口
M0 控制引脚    -> GPIO27 / GPIO13
```

将 M0 对应的 `Motor/IO` 选择开关拨到 `Motor`。开发板 DC 输入范围为 6-16V，实际供电必须匹配电机额定电压。不要用 USB 给电机供电，第一次测试从 15%-20% 功率开始，并防止堵转电流超过开发板允许值。

## 后端接口

网页访问：

```text
http://localhost:3000/dashboard/servos
```

后端接口：

```text
GET  /api/servos
POST /api/servos
POST /api/servos/status
GET  /api/device/commands?device_id=servo-quad-01
GET  /api/device/commands?device_id=servo-quad-02
GET  /api/propulsion/commands?device_id=maker-esp32-pro-dc-01
POST /api/propulsion/status
```

## 查看 WiFi 和电脑 IP 是否正确

### 1. 查看电脑当前 IPv4

在 PowerShell 或 CMD 执行：

```powershell
ipconfig | findstr IPv4
```

如果出现多个地址，优先看 `WLAN` 那一项，不要选 `192.168.56.1` 这种虚拟网卡地址。

示例：

```text
Wireless LAN adapter WLAN:
   IPv4 Address . . . . . . . . . . . : 10.161.51.97
```

那么固件里应该写：

```cpp
const char* SERVER_HOST = "10.161.51.97";
const char* SERVER_BASE = "http://10.161.51.97:5000";
```

### 2. 查看电脑保存的 WiFi 名称

```powershell
netsh wlan show profiles
```

固件里的 WiFi 名称需要与实际连接的 WiFi 一致：

```cpp
const char* WIFI_SSID = "Xiaomi 17";
```

### 3. 查看 WiFi 密码

```powershell
netsh wlan show profile name="Xiaomi 17" key=clear
```

在输出里查看：

```text
关键内容
```

或英文系统中的：

```text
Key Content
```

固件里的密码需要与这里一致：

```cpp
const char* WIFI_PASSWORD = "你的 WiFi 密码";
```

### 4. 验证后端是否能被 ESP32 访问

先运行项目：

```powershell
npm run dev
```

再在电脑浏览器访问：

```text
http://电脑IPv4:5000/api/health
```

例如：

```text
http://10.161.51.97:5000/api/health
```

如果浏览器打不开，ESP32 也一定连不上。优先检查：

- 后端是否正在运行。
- IP 是否是当前 WLAN 的 IPv4。
- Windows 防火墙是否允许 TCP 5000 入站。
- 电脑和 ESP32 是否在同一个 WiFi。

## SimpleFOC 双无刷推进板

固件路径：

```text
firmware/esp32/esp32_simplefoc_dual_propulsion/esp32_simplefoc_dual_propulsion.ino
```

当前配置：

```text
左电机 U/V/W：GPIO32 / GPIO33 / GPIO25
右电机 U/V/W：GPIO26 / GPIO27 / GPIO14
```

该板未提供独立 EN 引脚，因此固件按 3PWM 模式使用。

正式测试前仍需确认：

```text
电机型号
极对数
供电电压
最大电流
是否安装编码器
左右电机方向
```

第一次测试无刷电机时不要安装螺旋桨。
