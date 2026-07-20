# 固件目录

本目录存放项目相关 ESP32 固件。

## 推荐烧录入口

```text
esp32/maker_esp32_pro_servo_temp_01
```

第一块 MAKER-ESP32-PRO，舵机设备 ID 为 `servo-quad-01`，直流电机设备 ID 为 `maker-esp32-pro-dc-01`。负责四路舵机控制和 M0 端口 37GB555 直流电机控制。

```text
esp32/maker_esp32_pro_four_servo_02
```

第二块 MAKER-ESP32-PRO，设备 ID 为 `servo-quad-02`。负责第 5-8 路舵机控制。

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
- 电机和推进器测试必须低速、无桨、可断电。
