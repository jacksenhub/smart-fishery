import { randomUUID, timingSafeEqual } from "node:crypto";
import dgram from "node:dgram";
import { networkInterfaces } from "node:os";
import cors from "cors";
import dotenv from "dotenv";
import express, { type NextFunction, type Request, type Response } from "express";
import type {
  AIReport,
  BatteryData,
  DeviceStatus,
  PlatformDataMode,
  PlatformSnapshot,
  PropulsionSnapshot,
  ServoSnapshot,
  SystemLog,
  TwinSimulationInput,
  VesselStatus,
  WaterData,
  WaterStatus,
} from "@fishery/shared";
import { aiStatus, generateDecisionReport } from "./ai-service.js";
import { getGpsStatus, updateGpsStatus } from "./gps-store.js";
import {
  createAIReport,
  createBatteries,
  createDemoWaterSample,
  createNavigation,
  createVesselStatus,
  createWaterSeries,
} from "./mock-data.js";
import { flushPersistedState, loadPersistedState, schedulePersistState } from "./persistence.js";
import {
  getPropulsionSnapshot,
  setPropulsionTarget,
  takePropulsionCommands,
  updatePropulsionStatus,
} from "./propulsion-store.js";
import {
  getServoSnapshot,
  setServoTargets,
  takeServoCommands,
  updateServoStatus,
} from "./servo-store.js";
import { runTwinSimulation } from "./twin-simulator.js";

dotenv.config();

function readPort(value: string | undefined, fallback: number, label: string) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${label} must be an integer from 1 to 65535`);
  }
  return parsed;
}

const app = express();
const port = readPort(process.env.PORT, 5000, "PORT");
const host = process.env.HOST || "0.0.0.0";
const discoveryPort = readPort(process.env.UISYS_DISCOVERY_PORT, 42110, "UISYS_DISCOVERY_PORT");
const discoveryRequest = "UISYS_DISCOVER_V1";
const discoveryResponse = `UISYS_BACKEND_V1|${port}`;
const discoveryClientPorts = [42111, 42112, 42113, 42114] as const;
const discoveryAnnounceIntervalMs = 1000;
const maxHistory = 180;
const demoWaterFeedEnabled = process.env.UISYS_DEMO_WATER_FEED === "true";
const demoWaterIntervalMs = Math.max(2000, Number(process.env.UISYS_DEMO_WATER_INTERVAL_MS || 4000));
const sensorFreshnessMs = Math.max(5000, Number(process.env.UISYS_SENSOR_FRESHNESS_MS || 30_000));
const operatorToken = process.env.UISYS_API_TOKEN?.trim() || "";
const configuredOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set(configuredOrigins.length > 0 ? configuredOrigins : [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const persisted = loadPersistedState();
let waterHistory: WaterData[] = persisted?.waterHistory.length
  ? persisted.waterHistory.map((point) => ({ ...point, source: point.source || "sensor" }))
  : createWaterSeries(96);
let batteries: BatteryData[] = persisted?.batteries.length
  ? persisted.batteries.map((battery) => ({
      ...battery,
      source: battery.source || "sensor",
      lastUpdatedAt: battery.lastUpdatedAt || new Date().toISOString(),
    }))
  : createBatteries();
let latestAiReport: AIReport | null = persisted?.latestAiReport ?? null;
const systemLogs: SystemLog[] = [...(persisted?.systemLogs ?? [])];
let demoWaterCursor = waterHistory.length;
let lastDemoWaterAt = Date.now();
let hasReceivedRealWater = waterHistory.some((point) => point.source === "sensor");
let lastRealWaterAt = waterHistory.reduce((latest, point) => {
  if (point.source !== "sensor") return latest;
  const timestamp = new Date(point.timestamp).getTime();
  return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
}, 0);
let lastAiRequestAt = 0;

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
}));
app.use(express.json({ limit: "1mb" }));

function persistPlatformState() {
  schedulePersistState({ waterHistory, batteries, latestAiReport, systemLogs });
}

function appendLog(level: SystemLog["level"], title: string, detail: string, source = "system") {
  const entry: SystemLog = {
    id: randomUUID(),
    level,
    title,
    detail,
    source,
    timestamp: new Date().toISOString(),
  };
  systemLogs.unshift(entry);
  systemLogs.splice(80);
  persistPlatformState();
  return entry;
}

function isLoopback(address: string | undefined) {
  if (!address) return false;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function tokenMatches(candidate: string) {
  if (!operatorToken || !candidate) return false;
  const expected = Buffer.from(operatorToken);
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function requireControlAuthorization(req: Request, res: Response, next: NextFunction) {
  if (isLoopback(req.socket.remoteAddress)) {
    next();
    return;
  }
  if (!operatorToken) {
    res.status(503).json({ error: "UISYS_API_TOKEN must be configured before accepting LAN control requests" });
    return;
  }
  if (!tokenMatches(req.get("x-uisys-token") || "")) {
    res.status(401).json({ error: "invalid or missing X-UISYS-Token" });
    return;
  }
  next();
}

function readBoundedOptionalNumber(
  payload: Record<string, unknown>,
  keys: string[],
  minimum: number,
  maximum: number,
) {
  const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(payload, candidate));
  if (!key) return undefined;
  const raw = payload[key];
  if (raw === null || raw === undefined || raw === "") {
    throw new Error(`${key} must be a number from ${minimum} to ${maximum}`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be a number from ${minimum} to ${maximum}`);
  }
  return value;
}

function appendDemoWaterIfNeeded() {
  if (!demoWaterFeedEnabled || hasReceivedRealWater) return;
  const now = Date.now();
  if (now - lastDemoWaterAt < demoWaterIntervalMs) return;
  const packet = createDemoWaterSample(waterHistory.at(-1), demoWaterCursor, now);
  demoWaterCursor += 1;
  lastDemoWaterAt = now;
  waterHistory = [...waterHistory, packet].slice(-maxHistory);
  persistPlatformState();
}

function dataModeFor(water: WaterData[]): PlatformDataMode {
  const sources = new Set(water.map((point) => point.source));
  if (sources.size > 1) return "mixed";
  if (sources.has("sensor")) return "live";
  if (sources.has("fallback")) return "fallback";
  return "demo";
}

function currentNavigation() {
  const navigation = createNavigation();
  const gps = getGpsStatus();
  if (!gps.online || !gps.valid || gps.lat === null || gps.lng === null) {
    return { ...navigation, source: "mock" as const, gps };
  }

  const position = {
    lat: gps.lat,
    lng: gps.lng,
    label: "GPS 实时定位",
    timestamp: gps.last_fix_at || gps.last_seen || undefined,
  };
  return {
    ...navigation,
    position,
    route: [],
    targetWaypoint: position,
    speed: gps.speed_mps ?? 0,
    heading: gps.heading_deg ?? 0,
    remainingDistance: 0,
    etaMinutes: 0,
    source: "gps" as const,
    gps,
  };
}

function deviceStatus(online: boolean): DeviceStatus {
  return online ? "online" : "offline";
}

function currentVesselStatus(): VesselStatus {
  const base = createVesselStatus();
  const gps = getGpsStatus();
  const servos = getServoSnapshot() as ServoSnapshot;
  const propulsion = getPropulsionSnapshot() as PropulsionSnapshot;
  const sensorOnline = lastRealWaterAt > 0 && Date.now() - lastRealWaterAt <= sensorFreshnessMs;
  const esp32Online = gps.online || servos.online || propulsion.online || sensorOnline;
  const communicationOnline = gps.online || servos.online || propulsion.online;
  return {
    ...base,
    online: esp32Online || sensorOnline,
    aiReady: true,
    pixhawk: "offline",
    esp32: deviceStatus(esp32Online),
    communication: deviceStatus(communicationOnline),
    sensor: deviceStatus(sensorOnline),
  };
}

function snapshotFromWater(water: WaterData[], snapshotBatteries = batteries): PlatformSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    dataMode: dataModeFor(water),
    water,
    batteries: snapshotBatteries,
    navigation: currentNavigation(),
    aiReport: latestAiReport || createAIReport(water),
    vessel: currentVesselStatus(),
  };
}

function currentSnapshot() {
  appendDemoWaterIfNeeded();
  return snapshotFromWater(waterHistory);
}

function waterStatus(turbidity: number, ph: number, dissolvedOxygen: number, ammoniaNitrogen: number): WaterStatus {
  if (turbidity > 65 || ph < 6.4 || ph > 8.8 || dissolvedOxygen < 3.5 || ammoniaNitrogen > 0.5) return "polluted";
  if (turbidity > 48 || ammoniaNitrogen > 0.3) return "algae-risk";
  if (turbidity > 34 || ph < 6.8 || ph > 8.4 || dissolvedOxygen < 5.5 || ammoniaNitrogen > 0.2) return "attention";
  return "normal";
}

const discoveryServer = dgram.createSocket({ type: "udp4", reuseAddr: true });

function ipv4ToNumber(address: string) {
  return address.split(".").reduce((value, octet) => (((value << 8) | Number(octet)) >>> 0), 0);
}

function numberToIpv4(value: number) {
  return [24, 16, 8, 0].map((shift) => String((value >>> shift) & 255)).join(".");
}

function localBroadcastAddresses() {
  const addresses = new Set<string>();
  Object.values(networkInterfaces()).flat().forEach((network) => {
    if (!network || network.internal || network.family !== "IPv4") return;
    const address = ipv4ToNumber(network.address);
    const netmask = ipv4ToNumber(network.netmask);
    addresses.add(numberToIpv4(((address & netmask) | (~netmask >>> 0)) >>> 0));
  });
  return [...addresses];
}

function announceBackend() {
  localBroadcastAddresses().forEach((broadcastAddress) => {
    discoveryClientPorts.forEach((clientPort) => {
      discoveryServer.send(discoveryResponse, clientPort, broadcastAddress, () => undefined);
    });
  });
}

discoveryServer.on("message", (message, remote) => {
  const request = message.toString("utf8").trim();
  if (request !== discoveryRequest && !request.startsWith(`${discoveryRequest}|`)) return;
  discoveryServer.send(discoveryResponse, remote.port, remote.address);
});
discoveryServer.on("error", (error: NodeJS.ErrnoException) => {
  console.error(`Backend discovery UDP error: ${error.message}`);
  if (error.code === "EADDRINUSE" || error.code === "EACCES") {
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  }
});
discoveryServer.bind(discoveryPort, "0.0.0.0", () => {
  discoveryServer.setBroadcast(true);
  console.log(`ESP32 backend discovery listening on udp://0.0.0.0:${discoveryPort}`);
  announceBackend();
  discoveryAnnouncementTimer = setInterval(announceBackend, discoveryAnnounceIntervalMs);
  discoveryAnnouncementTimer.unref();
});

appendLog("success", "平台服务已启动", "后端已加载水质、AI、GPS、舵机、推进器和日志接口");

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "fishery-digital-twin-api",
    time: new Date().toISOString(),
    dataMode: dataModeFor(waterHistory),
    persistence: "enabled",
    ai: aiStatus(),
    gps: getGpsStatus(),
    servos: getServoSnapshot(),
    propulsion: getPropulsionSnapshot(),
  });
});

app.get("/api/snapshot", (_req, res) => res.json(currentSnapshot()));

app.get("/api/water", (_req, res) => {
  appendDemoWaterIfNeeded();
  res.json(waterHistory);
});

app.get("/api/batteries", (_req, res) => res.json(batteries));
app.get("/api/navigation", (_req, res) => res.json(currentNavigation()));
app.get("/api/gps", (_req, res) => res.json(getGpsStatus()));
app.get("/api/vessel", (_req, res) => res.json(currentVesselStatus()));

app.post("/api/gps/status", requireControlAuthorization, (req, res) => {
  try {
    const result = updateGpsStatus(req.body || {});
    if (result.fixAcquired) {
      appendLog(
        "success",
        "GPS 已获得有效定位",
        `${result.gps.lat?.toFixed(7)}, ${result.gps.lng?.toFixed(7)} · ${result.gps.satellites ?? 0} 颗卫星`,
        result.gps.device_id,
      );
    } else if (result.becameOnline) {
      appendLog("info", "GPS 串口数据已接入", "正在等待有效卫星定位", result.gps.device_id);
    }
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "invalid GPS status" });
  }
});

app.post("/api/data", requireControlAuthorization, (req, res) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const latest = waterHistory.at(-1);
    const waterTemperature = readBoundedOptionalNumber(body, ["waterTemperature", "water_temperature"], -5, 50);
    const turbidity = readBoundedOptionalNumber(body, ["turbidity"], 0, 1000);
    const ph = readBoundedOptionalNumber(body, ["ph", "pH"], 0, 14);
    const dissolvedOxygen = readBoundedOptionalNumber(body, ["dissolvedOxygen", "dissolved_oxygen", "do"], 0, 30);
    const ammoniaNitrogen = readBoundedOptionalNumber(body, ["ammoniaNitrogen", "ammonia_nitrogen", "nh3"], 0, 100);
    const conductivity = readBoundedOptionalNumber(body, ["conductivity", "ec"], 0, 200_000);
    const batteryPercent = readBoundedOptionalNumber(body, ["batteryPercent", "battery_percent"], 0, 100);

    if ([waterTemperature, turbidity, ph, dissolvedOxygen, ammoniaNitrogen, conductivity, batteryPercent]
      .every((value) => value === undefined)) {
      throw new Error("provide at least one supported numeric field");
    }

    const nextTemperature = waterTemperature ?? latest?.waterTemperature ?? 24.5;
    const nextTurbidity = turbidity ?? latest?.turbidity ?? 26;
    const nextPh = ph ?? latest?.ph ?? 7.4;
    const nextDissolvedOxygen = dissolvedOxygen ?? latest?.dissolvedOxygen ?? 6.8;
    const nextAmmoniaNitrogen = ammoniaNitrogen ?? latest?.ammoniaNitrogen ?? 0.08;
    const nextConductivity = conductivity ?? latest?.conductivity ?? 460;
    const receivedAt = new Date().toISOString();
    const packet: WaterData = {
      timestamp: receivedAt,
      source: "sensor",
      waterTemperature: Number(nextTemperature.toFixed(1)),
      turbidity: Number(nextTurbidity.toFixed(1)),
      ph: Number(nextPh.toFixed(2)),
      dissolvedOxygen: Number(nextDissolvedOxygen.toFixed(1)),
      ammoniaNitrogen: Number(nextAmmoniaNitrogen.toFixed(2)),
      conductivity: Math.round(nextConductivity),
      status: waterStatus(nextTurbidity, nextPh, nextDissolvedOxygen, nextAmmoniaNitrogen),
    };

    waterHistory = hasReceivedRealWater ? [...waterHistory, packet].slice(-maxHistory) : [packet];
    hasReceivedRealWater = true;
    lastRealWaterAt = Date.now();
    if (batteryPercent !== undefined) {
      const percentage = Math.round(batteryPercent);
      batteries = batteries.map((battery, index) => index === 0 ? {
        ...battery,
        percentage,
        voltage: Number((10.5 + percentage * 0.021).toFixed(2)),
        status: percentage <= 20 ? "warning" : "online",
        source: "sensor",
        lastUpdatedAt: receivedAt,
      } : battery);
    }

    latestAiReport = null;
    appendLog(
      "info",
      "传感器数据已接收",
      `水温 ${packet.waterTemperature}°C，浊度 ${packet.turbidity} NTU，溶解氧 ${packet.dissolvedOxygen} mg/L`,
      String(body.device_id || "esp32"),
    );
    persistPlatformState();
    res.status(201).json({ message: "ok", packet, snapshot: currentSnapshot() });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "invalid sensor data" });
  }
});

app.post("/api/demo/simulate", requireControlAuthorization, (req, res) => {
  const requestedCount = Number(req.body?.count ?? 96);
  const count = Number.isFinite(requestedCount) ? Math.max(24, Math.min(240, Math.round(requestedCount))) : 96;
  const demoWater = createWaterSeries(count);
  const demoBatteries = createBatteries();
  const demoSnapshot = snapshotFromWater(demoWater, demoBatteries);
  demoSnapshot.aiReport = createAIReport(demoWater);
  const log = appendLog("info", "演示数据已生成", `生成了 ${count} 个独立演示采样点，未修改实时历史`, "demo");
  res.status(201).json({ count, water: demoWater, snapshot: demoSnapshot, log });
});

app.post("/api/simulate", requireControlAuthorization, (_req, res) => {
  res.status(410).json({ error: "This endpoint was removed. Use /api/demo/simulate; demo data no longer overwrites live history." });
});

app.get("/api/ai/status", (_req, res) => res.json({ ...aiStatus(), hasReport: latestAiReport !== null }));
app.get("/api/ai/report", (_req, res) => {
  if (!latestAiReport) {
    res.status(404).json({ message: "No AI report yet" });
    return;
  }
  res.json(latestAiReport);
});

app.post("/api/ai/report", requireControlAuthorization, async (_req, res) => {
  const now = Date.now();
  if (now - lastAiRequestAt < 60_000) {
    res.status(429).json({ error: "AI report generation is limited to once per minute" });
    return;
  }
  lastAiRequestAt = now;
  try {
    latestAiReport = await generateDecisionReport(waterHistory, batteries);
    const log = appendLog("success", "AI 预测报告已生成", `${latestAiReport.title} · ${latestAiReport.sampleCount} 个采样点`, latestAiReport.model);
    persistPlatformState();
    res.status(201).json({ report: latestAiReport, log });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI report failed";
    const log = appendLog("error", "AI 预测报告生成失败", message, "ai");
    res.status(503).json({ error: message, log });
  }
});

app.get("/api/servos", (req, res) => {
  const deviceId = typeof req.query.device_id === "string" ? req.query.device_id : undefined;
  res.json(getServoSnapshot(deviceId));
});

app.post("/api/servos", requireControlAuthorization, (req, res) => {
  try {
    const result = setServoTargets(req.body || {});
    appendLog("info", "舵机命令已下发", `${result.command.device_id}: ${result.command.angles.map((angle, index) => `S${index + 1} ${angle}°`).join(" / ")}`, result.command.device_id);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "invalid servo request" });
  }
});

app.post("/api/servos/status", requireControlAuthorization, (req, res) => {
  try {
    const result = updateServoStatus(req.body || {});
    appendLog("success", "舵机控制板在线", result.device.device_id, result.device.device_id);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "invalid servo status" });
  }
});

app.get("/api/device/commands", requireControlAuthorization, (req, res) => {
  const deviceId = typeof req.query.device_id === "string" ? req.query.device_id : undefined;
  res.json(takeServoCommands(deviceId));
});

app.get("/api/propulsion", (req, res) => {
  const deviceId = typeof req.query.device_id === "string" ? req.query.device_id : undefined;
  res.json(getPropulsionSnapshot(deviceId));
});

app.post("/api/propulsion", requireControlAuthorization, (req, res) => {
  try {
    const result = setPropulsionTarget(req.body || {});
    appendLog(
      result.command.emergency_stop ? "warning" : "info",
      result.command.emergency_stop ? "推进器急停已触发" : "推进器命令已下发",
      `${result.command.device_id}: ${result.command.mode} · L ${result.command.left_power}% / R ${result.command.right_power}%`,
      result.command.device_id,
    );
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "invalid propulsion request" });
  }
});

app.post("/api/propulsion/status", requireControlAuthorization, (req, res) => {
  try {
    const result = updatePropulsionStatus(req.body || {});
    appendLog("success", "推进控制板在线", result.device.device_id, result.device.device_id);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "invalid propulsion status" });
  }
});

app.get("/api/propulsion/commands", requireControlAuthorization, (req, res) => {
  const deviceId = typeof req.query.device_id === "string" ? req.query.device_id : undefined;
  res.json(takePropulsionCommands(deviceId));
});

app.post("/api/twin/simulate", requireControlAuthorization, (req, res) => {
  try {
    const result = runTwinSimulation(
      (req.body || {}) as Partial<TwinSimulationInput>,
      currentSnapshot(),
      getServoSnapshot() as ServoSnapshot,
      getPropulsionSnapshot() as PropulsionSnapshot,
    );
    appendLog("info", "数字孪生推演已完成", `航线 ${result.route.distanceKm} km · ${result.fault.title} · 健康度 ${result.fatigue.overallHealth}%`, result.modelVersion);
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "twin simulation failed";
    appendLog("error", "数字孪生推演失败", message, "twin-simulator");
    res.status(400).json({ error: message });
  }
});

app.get("/api/logs", (_req, res) => res.json(systemLogs));

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(error.message.includes("not allowed by CORS") ? 403 : 500).json({ error: error.message });
});

let discoveryAnnouncementTimer: NodeJS.Timeout | null = null;
const httpServer = app.listen(port, host, () => {
  console.log(`Fishery digital twin API listening on http://${host}:${port}`);
  console.log(`Local API: http://localhost:${port}`);
  console.log("LAN control and device requests require X-UISYS-Token when UISYS_API_TOKEN is configured.");
  if (!operatorToken) {
    console.warn("UISYS_API_TOKEN is not configured; ESP32 LAN requests will be rejected with HTTP 503.");
  }
});

httpServer.on("error", (error: NodeJS.ErrnoException) => {
  console.error(`Backend HTTP startup error on ${host}:${port}: ${error.message}`);
  process.exitCode = 1;
  if (error.code === "EADDRINUSE" || error.code === "EACCES") {
    setImmediate(() => process.exit(1));
  }
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping backend services.`);
  flushPersistedState();
  if (discoveryAnnouncementTimer) clearInterval(discoveryAnnouncementTimer);
  try {
    discoveryServer.close();
  } catch {
    // The UDP socket may not have finished binding after a startup failure.
  }
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3_000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
