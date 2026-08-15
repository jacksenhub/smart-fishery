# 固件目录

本目录存放项目相关 ESP32 固件。

## 推荐烧录入口

```text
esp32/maker_esp32_pro_servo_temp_01
```

第一块 MAKER-ESP32-PRO，负责三路舵机、GPS、M0 端口 37GB555 正反转电机，以及 M1/M2 双推杆。设备 ID 分别为 `servo-quad-01`、`gps-01`、`maker-esp32-pro-dc-01` 和 `maker-esp32-pro-linear-02`。

```text
esp32/maker_esp32_pro_four_servo_02
```

第二块 MAKER-ESP32-PRO，舵机设备 ID 为 `servo-quad-02`，SXTL 设备 ID 为 `maker-esp32-pro-linear-01-m1`。负责整体编号第 4-7 路舵机和 M0 端口 SXTL 推杆控制。

```text
esp32/esp32_simplefoc_dual_propulsion
```

ESP32 SimpleFOC 双路无刷推进板，设备 ID 为 `mks-foc-dual-01`。当前作为后续推进扩展固件保留。


## 烧录前通用检查

- Arduino IDE 已选择正确开发板和串口。
- WiFi 名称和密码正确。
- `SERVER_HOST` 是电脑当前 WLAN IPv4。
- `SERVER_BASE` 是 `http://电脑IPv4:5000`。
- 后端正在运行，端口为 `5000`。
- 舵机需要外部稳定供电。
- 37GB555 电机和推杆必须使用匹配额定电压、能够承受堵转电流的独立电源。
- 推杆需要内置端点限位；没有内置限位时，必须加装外部限位开关。
- 电机和推杆第一次测试应从低功率开始，并保证可以立即断电。
