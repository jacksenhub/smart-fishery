# ESP32 SimpleFOC 双路无刷推进板

这个目录用于 ESP32 SimpleFOC 双路无刷驱动板，目标是作为后续推进系统扩展固件，驱动左右两个无刷电机。

当前前端导航中已经不单独展示推进系统页面，固件和后端接口仍保留，方便后续需要时重新接入。

## 文件

```text
esp32_simplefoc_dual_propulsion.ino
```

## 当前状态

固件已经接入项目后端接口：

```text
GET  /api/propulsion/commands?device_id=mks-foc-dual-01
POST /api/propulsion/status
```

后端中的左右推进器输出会变成命令：

```text
left_power
right_power
```

固件再把它们转换成 SimpleFOC 的开环速度目标。

## 引脚配置

当前固件已经按 FOC_ESP32_X2(303FOCESP21) 原理图和你提供的信息配置：

```text
左电机：
U = GPIO32
V = GPIO33
W = GPIO25

右电机：
U = GPIO26
V = GPIO27
W = GPIO14
```

你没有提供独立 EN 引脚，因此固件按 3PWM 模式创建驱动器：

```cpp
BLDCDriver3PWM leftDriver = BLDCDriver3PWM(LEFT_PWM_U, LEFT_PWM_V, LEFT_PWM_W);
BLDCDriver3PWM rightDriver = BLDCDriver3PWM(RIGHT_PWM_U, RIGHT_PWM_V, RIGHT_PWM_W);
```

固件仍然默认保持安全模式：

```cpp
#define PIN_MAP_CONFIRMED 1
#define MOTOR_OUTPUT_ENABLED 0
```

这时程序可以联网、轮询命令、回传状态，但不会真正驱动电机。

第一次无桨测试确认无误后，再改成：

```cpp
#define MOTOR_OUTPUT_ENABLED 1
```

## 电流采样

原理图显示板上有 INA240 电流采样放大器，采样电阻为 10mΩ。

固件已记录 ADC 引脚：

```text
左电机：
A 相电流采样 = GPIO35
B 相电流采样 = GPIO34

右电机：
A 相电流采样 = GPIO39
B 相电流采样 = GPIO36
```

默认不启用电流采样：

```cpp
#define USE_CURRENT_SENSE 0
```

如果确认 INA240 具体型号后，可以修改增益：

```cpp
const float INA240_GAIN = 20.0f;
```

常见增益：

```text
INA240A1 = 20 V/V
INA240A2 = 50 V/V
INA240A3 = 100 V/V
INA240A4 = 200 V/V
```

确认后再改为：

```cpp
#define USE_CURRENT_SENSE 1
```

## 编码器接口

原理图中 P2 为 I2C 编码器接口，更适合 AS5600 / MT6701 这类磁编码器。

固件已记录引脚：

```text
左编码器：
SCL = GPIO18
SDA = GPIO19

右编码器：
SCL = GPIO15
SDA = GPIO13
```

默认不启用编码器：

```cpp
#define USE_I2C_ENCODERS 0
#define USE_CLOSED_LOOP_VELOCITY 0
```

如果后续安装 AS5600 磁编码器，可以打开：

```cpp
#define USE_I2C_ENCODERS 1
#define USE_CLOSED_LOOP_VELOCITY 1
```

如果使用的不是 AS5600，需要替换代码中的编码器类型。

## 电机参数

还需要确认无刷电机极对数：

```cpp
const int LEFT_POLE_PAIRS = 7;
const int RIGHT_POLE_PAIRS = 7;
```

如果极对数不对，电机可能抖动、发热或无法稳定转动。

目前仍需你补充：

```text
电机型号
极对数
实际供电电压
最大电流
是否安装编码器
左电机正方向
右电机正方向
```

## 初始安全限制

默认限制比较保守：

```cpp
const float MOTOR_VOLTAGE_LIMIT = 3.0f;
const float MAX_VELOCITY_RAD_PER_SEC = 24.0f;
```

建议先保持低电压、低速度测试。

## 第一次测试步骤

1. 不要安装螺旋桨。
2. 只连接电机和电源，确认共地。
3. Arduino IDE 安装 `SimpleFOC` 库。
4. 先保持 `MOTOR_OUTPUT_ENABLED = 0` 上传，确认网页能看到状态。
5. 确认 U/V/W 接线和电机极对数后再启用输出。
6. 后续重新启用推进系统页面或接口后，先切到 WEB 模式，低速测试。
7. 如果电机方向反了，先不要换线，后续可以在代码中加方向修正。

## 控制逻辑

网页端使用差速推进逻辑：

```text
左推进器 = 油门 + 转向
右推进器 = 油门 - 转向
```

固件只接收最终结果：

```text
left_power:  -100 到 100
right_power: -100 到 100
```

安全条件：

```text
WEB 模式 + 已启用 + 没有急停
```

否则固件会把两个电机目标设为 0。

## 失联保护

固件带有命令超时保护：

```cpp
const unsigned long COMMAND_TIMEOUT_MS = 1200;
```

超过约 1.2 秒没有收到新命令，会自动停车。

这适合安全测试，但如果以后要连续网页控制，需要让前端周期性发送心跳命令。
