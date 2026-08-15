# 安全与网络配置

## 本地密钥文件

仓库不再保存 WiFi、API 或设备控制令牌。每个固件目录都提供 `wifi_secrets.example.h`；复制为同目录下的 `wifi_secrets.h` 后填写：

```cpp
inline constexpr char WIFI_SSID[] = "你的热点名称";
inline constexpr char WIFI_PASSWORD[] = "你的热点密码";
inline constexpr char UISYS_API_TOKEN[] = "一段足够长的随机令牌";
```

`wifi_secrets.h` 和 `.env` 均已被 `.gitignore` 忽略。不要截图、压缩或提交这些文件。若任何密钥曾进入公开仓库，应立即轮换；仅从当前文件中删除不能清除 Git 历史。

推荐使用 `npm run setup:devices` 同步配置。已有合格令牌时该命令会保留它，避免已烧录设备突然出现 401；只有准备重新烧录全部设备时才使用 `npm run setup:devices:rotate`。

## 后端配置

复制 `apps/backend/.env.example` 为 `apps/backend/.env`，并让以下值与所有固件中的 `UISYS_API_TOKEN` 完全一致：

```text
UISYS_API_TOKEN=一段足够长的随机令牌
CORS_ORIGIN=http://localhost:3000,http://127.0.0.1:3000
```

来自本机回环地址的操作允许直接访问；来自局域网的设备上报、命令轮询和控制请求必须携带 `X-UISYS-Token`。未配置令牌时，后端拒绝局域网控制请求。

## 自动发现与防火墙

电脑和 ESP32 必须位于同一个可信的 2.4GHz 热点或专用路由器，且不能启用客户端隔离。固件通过 UDP 42110 发现后端，电脑向 42111-42114 主动公告；HTTP API 使用 TCP 5000。

查看 WLAN 地址：

```powershell
ipconfig | findstr IPv4
```

运行以下命令可将当前 WLAN 配置为专用网络并添加两条最小范围规则：

```powershell
npm run setup:network
```

不要在公共校园 WiFi、带网页认证的网络或不受信任的共享热点上运行控制服务。

## 桌面安装版

`setup:devices` 会把不含 WiFi 密码的后端运行配置同步到当前 Windows 用户的 `%APPDATA%\渔博士\backend.env`。桌面安装版运行时从该文件读取设备令牌；令牌不会被打进安装包。换 Windows 用户或换电脑后需要重新运行本地初始化。

若后端和固件已经同步，仅桌面配置缺失，可运行 `npm run setup:desktop`。它只复制当前后端令牌，不读取热点密码，也不会让已烧录开发板失效。

## DeepSeek

DeepSeek 密钥只放在 `apps/backend/.env`。当前默认模型为 `deepseek-v4-flash`，请求有超时和每分钟一次的限流。若密钥曾公开，必须在服务商控制台撤销并重新生成。
