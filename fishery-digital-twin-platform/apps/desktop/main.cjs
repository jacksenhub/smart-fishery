const { app, BrowserWindow, dialog, session } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const APP_NAME = "渔博士";
const FRONTEND_URL = "http://localhost:3000";
const FRONTEND_HEALTH_URL = `${FRONTEND_URL}/api/desktop-health`;
const API_HEALTH_URL = "http://127.0.0.1:5000/api/health";
const runtimeRoot = app.isPackaged
  ? path.join(process.resourcesPath, "app.asar.unpacked", "apps", "desktop", "runtime")
  : path.join(__dirname, "runtime");
const iconPath = path.join(__dirname, "assets", "app-icon.ico");
const children = new Set();
let isQuitting = false;
let logStream;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const separator = trimmed.indexOf("=");
    values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return values;
}

app.setName(APP_NAME);
app.setAppUserModelId("com.yuboshi.fishery");

function runtimePath(relativePath) {
  return path.join(runtimeRoot, ...relativePath.split("/"));
}

function startNodeProcess(scriptPath, environment, cwd) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ...environment,
    },
    stdio: logStream ? ["ignore", logStream, logStream] : "ignore",
  });

  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function probeService(url, expectedService) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) return "wrong";
    const body = await response.json();
    return body?.service === expectedService ? "match" : "wrong";
  } catch {
    return "unreachable";
  }
}

async function waitForService(url, expectedService, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeService(url, expectedService) === "match") return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`服务启动超时：${url}`);
}

function stopServices() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  children.clear();
  logStream?.end();
}

async function startServices() {
  const manifestPath = path.join(runtimeRoot, "desktop-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("桌面运行文件不存在，请先执行 npm run desktop:build。 ");
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const backendScript = runtimePath(manifest.backendScript);
  const frontendScript = runtimePath(manifest.frontendServer);
  const backendEnvironment = readEnvFile(path.join(app.getPath("userData"), "backend.env"));

  const backendProbe = await probeService(API_HEALTH_URL, "fishery-digital-twin-api");
  if (backendProbe === "wrong") {
    throw new Error("端口 5000 已被其他服务占用，请关闭占用程序后重试。");
  }
  if (backendProbe === "unreachable") {
    startNodeProcess(backendScript, {
      ...backendEnvironment,
      PORT: "5000",
      HOST: "0.0.0.0",
      UISYS_DATA_DIR: path.join(app.getPath("userData"), "data"),
    }, path.dirname(backendScript));
    await waitForService(API_HEALTH_URL, "fishery-digital-twin-api", 25_000);
  }

  const frontendProbe = await probeService(FRONTEND_HEALTH_URL, "fishery-digital-twin-web");
  if (frontendProbe === "wrong") {
    throw new Error("端口 3000 已被其他服务占用，请关闭占用程序后重试。");
  }
  if (frontendProbe === "unreachable") {
    startNodeProcess(
      frontendScript,
      { PORT: "3000", HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
      path.dirname(frontendScript),
    );
    await waitForService(FRONTEND_HEALTH_URL, "fishery-digital-twin-web", 45_000);
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#eef5f7",
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin !== new URL(FRONTEND_URL).origin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  return mainWindow;
}

async function launch() {
  const logsDirectory = app.getPath("logs");
  fs.mkdirSync(logsDirectory, { recursive: true });
  logStream = fs.createWriteStream(path.join(logsDirectory, "desktop-services.log"), { flags: "a" });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => (
    permission === "media" && requestingOrigin.startsWith(FRONTEND_URL)
  ));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media" && webContents.getURL().startsWith(FRONTEND_URL));
  });

  const mainWindow = createWindow();
  try {
    await startServices();
    await mainWindow.loadURL(FRONTEND_URL);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dialog.showMessageBox({
      type: "error",
      title: `${APP_NAME}启动失败`,
      message: "本地服务没有成功启动",
      detail: `${message}\n\n日志位置：${path.join(logsDirectory, "desktop-services.log")}`,
    });
    app.quit();
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(launch);
}

app.on("before-quit", () => {
  isQuitting = true;
  stopServices();
});

app.on("window-all-closed", () => {
  if (!isQuitting) app.quit();
});
