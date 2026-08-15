# MAKER-ESP32-PRO 第一块控制板

目录名保留 `maker_esp32_pro_servo_temp_01` 以兼容现有烧录路径；当前固件已经移除温度传感器功能。

烧录文件：

```text
maker_esp32_pro_servo_temp_01.ino
```

该固件同时负责：

- 3 路舵机控制，设备 ID 为 `servo-quad-01`。
- GPS 数据接收，设备 ID 为 `gps-01`。
- M0 端口 37GB555 有刷直流电机，设备 ID 为 `maker-esp32-pro-dc-01`。
- M1、M2 端口双推杆，设备 ID 为 `maker-esp32-pro-linear-02`。

## Arduino IDE 依赖

在 Arduino IDE 的库管理器中安装：

```text
ESP32Servo
TinyGPSPlus
```

开发板使用 ESP32 Arduino Core 3.x，当前电脑已安装 `3.3.10`。

## 引脚和接线

舵机：

```text
Servo 1 -> GPIO25
Servo 2 -> GPIO26
Servo 3 -> GPIO32
Servo 4 -> GPIO33（GPS占用，不能接舵机）
```

水枪云台使用 Servo 1/2（GPIO25/GPIO26），网页、后端和本固件均将目标角度限制为 `0°–160°`。Servo 3 仍保留 `0°–180°`。

37GB555 直流电机：

```text
电机两根动力线 -> 板载 M0 电机输出口
M0 控制引脚    -> GPIO27 / GPIO13
```

双推杆：

```text
推杆 1 两根动力线 -> 板载 M1 电机输出口
M1 控制引脚       -> GPIO4 / GPIO2
推杆 2 两根动力线 -> 板载 M2 电机输出口
M2 控制引脚       -> GPIO17 / GPIO12
```

将 M2 的 `Motor/IO` 选择开关拨到 `Motor`。电机必须使用开发板的 `6-16V` DC 电源输入供电，不能用 USB 给电机供电。供电电压必须与电机额定电压一致。

37GB555 的堵转电流可能超过开发板允许电流。第一次测试必须悬空电机轴、从低功率开始，并保证可以立即断电。M0、M1、M2 均允许调节到 100%，网页双推杆初始功率为 50%。

M0、M1、M2 的 PWM 频率明确设置为 `1 kHz`，三路上限均为 100%，命令超时保护保持有效。双推杆升到高功率前，应先逐级测试每路负载电流和驱动板温度。

## 安全逻辑

- 上电默认停止。
- 只有 `WEB + enabled=true + emergency_stop=false` 的命令才允许输出。
- 超过 2.2 秒没有收到新命令自动停止。
- WiFi 断开立即停止。
- 正反转切换时先降到 0，再反向加速。
- M0 独立接收37GB555命令；M1、M2作为双推杆设备接收左右两路功率。
- 急停命令立即将对应电机通道的两路 PWM 清零。

## 后端接口

舵机使用原接口：

```text
GET  /api/device/commands?device_id=servo-quad-01
POST /api/servos/status
```

直流电机复用项目已有的推进命令接口：

```text
GET  /api/propulsion/commands?device_id=maker-esp32-pro-dc-01
GET  /api/propulsion/commands?device_id=maker-esp32-pro-linear-02
POST /api/propulsion/status
```

## PowerShell 低速测试

先启动项目后端并确认 ESP32 与电脑连接同一个 WiFi。以下命令让 M0 正转 20%，固件会在命令超时后自动停止：

```powershell
$body = @{
  device_id = "maker-esp32-pro-dc-01"
  mode = "WEB"
  enabled = $true
  emergency_stop = $false
  throttle = 20
  steering = 0
  max_power = 20
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:5000/api/propulsion" -Method Post -ContentType "application/json" -Body $body
```

反转时将 `throttle` 改成 `-20`。立即停止：

```powershell
$body = @{
  device_id = "maker-esp32-pro-dc-01"
  mode = "WEB"
  enabled = $false
  emergency_stop = $true
  throttle = 0
  steering = 0
  max_power = 20
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:5000/api/propulsion" -Method Post -ContentType "application/json" -Body $body
```

若正反方向与预期相反，断电后交换 M0 上的两根电机线，不要带电插拔。
