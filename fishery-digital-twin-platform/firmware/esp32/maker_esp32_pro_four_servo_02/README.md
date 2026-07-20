# MAKER-ESP32-PRO 四路舵机控制板 02

这个目录用于第二块 MAKER-ESP32-PRO 舵机控制板。

## 烧录文件

```text
maker_esp32_pro_four_servo_02.ino
```

设备 ID：

```text
servo-quad-02
```

两块开发板的舵机接口引脚完全相同，但通过不同设备 ID 区分：

```text
第一块板：servo-quad-01
第二块板：servo-quad-02
```

## 舵机接口

```text
Servo 1 -> GPIO25
Servo 2 -> GPIO26
Servo 3 -> GPIO32
Servo 4 -> GPIO33
```

在网页中，第二块板对应整体舵机编号：

```text
舵机 5-8
```

## 使用前确认

1. 电脑后端保持运行，端口为 `5000`。
2. 第二块板和电脑连接同一个 WiFi。
3. 固件中的服务器地址指向电脑当前 WLAN IPv4。
4. 舵机使用外部稳定供电，不建议只靠 USB。
