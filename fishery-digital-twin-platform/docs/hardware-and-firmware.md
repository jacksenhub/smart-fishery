# 硬件与固件说明

## 当前硬件

- 第一块 MAKER-ESP32-PRO：三路舵机 + GPS + M0 端口 37GB555 正反转电机 + M1/M2 两个 12V 推杆。
- 第二块 MAKER-ESP32-PRO：四路舵机 + M0 端口 SXTL 电动推杆。
- ESP32 SimpleFOC 双路无刷推进板：保留为后续推进系统扩展。

## 当前烧录文件

### servo1：第一块舵机板 + GPS + 37GB555 + 双推杆

```text
firmware/esp32/maker_esp32_pro_servo_temp_01/maker_esp32_pro_servo_temp_01.ino
```

设备 ID：

```text
舵机：servo-quad-01
M0 正反转电机：maker-esp32-pro-dc-01
M1/M2 双推杆：maker-esp32-pro-linear-02
GPS：gps-01
```

功能：

- 控制第 1-3 路舵机。
- 使用 Servo 4 的 GPIO33 接收 GPS 数据。
- 上报舵机状态到 `/api/servos/status`。
- 从 `/api/device/commands?device_id=servo-quad-01` 读取网页命令。
- 使用 GPIO27 / GPIO13 驱动 M0 端口的 37GB555 有刷直流电机。
- 使用 GPIO4 / GPIO2 驱动 M1 推杆，GPIO17 / GPIO12 驱动 M2 推杆。
- 水枪云台使用 GPIO25/GPIO26，两轴目标角度均限制为 `0°–160°`。
- 分别读取两个电机设备 ID 的命令，并向 `/api/propulsion/status` 独立上报状态。

### servo2：第二块舵机板 + SXTL 电动推杆

```text
firmware/esp32/maker_esp32_pro_four_servo_02/maker_esp32_pro_four_servo_02.ino
```

设备 ID：

```text
舵机：servo-quad-02
SXTL：maker-esp32-pro-linear-01-m1
```

功能：

- 控制整体编号第 4-7 路舵机。
- 上报舵机状态到 `/api/servos/status`。
- 从 `/api/device/commands?device_id=servo-quad-02` 读取网页命令。
- 使用 GPIO27 / GPIO13 驱动 M0 端口的 SXTL 推杆。
- 从 `/api/propulsion/commands?device_id=maker-esp32-pro-linear-01-m1` 读取推杆命令。
- 向 `/api/propulsion/status` 上报推杆控制器状态。

### 已停用旧入口

```text
firmware/esp32/maker_esp32_pro_four_servo/maker_esp32_pro_four_servo.ino
```

这个文件是旧的 servo1 纯舵机版本，已经停用。第一块板现在请统一烧录 `maker_esp32_pro_servo_temp_01.ino`。

## 舵机接口

每块 MAKER-ESP32-PRO 自带 4 个舵机接口：

```text
Servo 1 -> GPIO25
Servo 2 -> GPIO26
Servo 3 -> GPIO32
Servo 4 -> GPIO33
```

第一块板的 Servo 4 信号脚 GPIO33 已用于 GPS，因此不能再接舵机。最终可用舵机口为第一块板 3 路、第二块板 4 路，共 7 路。两块板通过不同的 `DEVICE_ID` 区分：

```text
第一块板：servo-quad-01
第二块板：servo-quad-02
```

舵机必须使用符合型号额定电压且能覆盖总堵转电流的独立电源，舵机电源 GND 与 ESP32 GND 必须共地。先单路、空载、90° 测试，再逐路接入；出现持续抖动、啸叫或发热时立即断电检查供电、接线、机械限位和脉宽范围。固件只在目标角度变化时更新 PWM，避免网络轮询重复写入相同角度。

## 37GB555 直流电机接线

```text
电机两根动力线 -> M0 电机输出口
M0 控制引脚    -> GPIO27 / GPIO13
```

将 M0 对应的 `Motor/IO` 选择开关拨到 `Motor`。开发板 DC 输入范围为 6-16V，实际供电必须匹配电机额定电压。不要用 USB 给电机供电，第一次测试从 15%-20% 功率开始，并防止堵转电流超过开发板允许值。

## 第一块板 M1/M2 双推杆接线

```text
推杆 1 两根动力线 -> 第一块板 M1 电机输出口
M1 控制引脚       -> GPIO4 / GPIO2
推杆 2 两根动力线 -> 第一块板 M2 电机输出口
M2 控制引脚       -> GPIO17 / GPIO12
设备 ID           -> maker-esp32-pro-linear-02
```

网页支持两路分别控制、同步伸出、同步缩回和全部停止。M2 的 `Motor/IO` 开关必须拨到 `Motor`。

## 第二块板 SXTL 推杆接线

```text
SXTL 两根动力线 -> 第二块板 M0 电机输出口
M0 控制引脚     -> GPIO27 / GPIO13
设备 ID         -> maker-esp32-pro-linear-01-m1
```

网页和后端允许 SXTL 输出到 100%。固件提供缓启动、断网停止、急停和 2.2 秒命令超时保护。正常操作时，“第一方向运行并停止，再以相反方向运行并停止”记为 1 次完整往返。累计完成 4 次完整往返，或累计指令运行时间达到 2 分钟，任一条件先满足都会停止输出并冷却 18 分钟；冷却结束后次数和时间同时清零。由于没有位置或电流传感器，推杆到达内置限位后仍需点击网页“停止”，否则固件会继续累计命令运行时间，且次数只是按控制顺序判断。

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
GET  /api/propulsion/commands?device_id=maker-esp32-pro-linear-01-m1
GET  /api/propulsion/commands?device_id=maker-esp32-pro-linear-02
POST /api/propulsion/status
```

## WiFi 与电脑后端自动发现

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

所有当前固件均不再写死电脑地址。它们通过 UDP 42110 查找后端：第一块板监听回复/公告端口 42111，第二块板监听 42112，独立 GPS 监听 42113，双无刷推进板监听 42114；电脑 IP 变化后会自动采用新的回复来源 IP。

### 2. 查看电脑保存的 WiFi 名称

```powershell
netsh wlan show profiles
```

复制对应固件目录的 `wifi_secrets.example.h` 为 `wifi_secrets.h`，再填写实际网络和与后端一致的令牌：

```cpp
inline constexpr char WIFI_SSID[] = "你的热点名称";
inline constexpr char WIFI_PASSWORD[] = "你的热点密码";
inline constexpr char UISYS_API_TOKEN[] = "与后端一致的随机令牌";
```

`wifi_secrets.h` 已被 Git 忽略，不要提交或公开分享。若不知道热点密码，请在路由器或热点管理端重设，不要把系统导出的明文密码粘贴进文档。

### 3. 验证后端是否能被 ESP32 访问

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
- 热点是否开启了客户端隔离。

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
