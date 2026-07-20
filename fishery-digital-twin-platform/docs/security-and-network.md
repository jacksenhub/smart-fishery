# 安全与网络配置说明

## 为什么固件里会有 WiFi 密码和电脑 IP

ESP32 不是运行在电脑上的网页，它需要自己连接 WiFi，再通过 HTTP 访问电脑后端。因此固件里必须知道：

```cpp
WIFI_SSID
WIFI_PASSWORD
SERVER_HOST
SERVER_BASE
```

比赛演示时这很正常，但不要公开分享包含这些信息的固件截图或压缩包。

## 如何判断 WiFi 信息是否正确

查看电脑保存的 WiFi：

```powershell
netsh wlan show profiles
```

查看指定 WiFi 密码：

```powershell
netsh wlan show profile name="Xiaomi 17" key=clear
```

固件里应该对应：

```cpp
const char* WIFI_SSID = "Xiaomi 17";
const char* WIFI_PASSWORD = "这里填 Key Content 对应的密码";
```

## 如何判断电脑 IP 是否正确

查看 IPv4：

```powershell
ipconfig | findstr IPv4
```

优先选择 WLAN 对应的 IPv4，不要选择虚拟网卡地址，例如：

```text
192.168.56.1
```

固件里需要写成：

```cpp
const char* SERVER_HOST = "电脑 WLAN IPv4";
const char* SERVER_BASE = "http://电脑 WLAN IPv4:5000";
```

## 推荐比赛网络

推荐：

- 手机热点。
- 专用 2.4GHz 路由器。
- 电脑和 ESP32 都连接同一个网络。

不推荐：

- 公共校园 WiFi。
- 需要网页认证的 WiFi。
- 会隔离设备的公共网络。

## 防火墙检查

ESP32 需要访问电脑 `5000` 端口。若无法连接，在管理员 PowerShell 中执行：

```powershell
New-NetFirewallRule -DisplayName "Fishery API 5000" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5000 -Profile Any
```

## 密钥保护

- DeepSeek 密钥只保存在 `apps/backend/.env`。
- `.env` 已被 `.gitignore` 忽略，不会被正常 Git 提交。
- 不要把 `.env` 发给别人。
- 如果密钥曾经公开过，建议到 DeepSeek 控制台重新生成密钥。
