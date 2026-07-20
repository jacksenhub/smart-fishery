import { randomUUID } from "node:crypto";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import type { AIReport, BatteryData, PlatformSnapshot, PropulsionSnapshot, ServoSnapshot, SystemLog, TwinSimulationInput, WaterData, WaterStatus } from "@fishery/shared";
import { aiStatus, generateDecisionReport } from "./ai-service.js";
import { createAIReport, createBatteries, createDemoWaterSample, createNavigation, createVesselStatus, createWaterSeries } from "./mock-data.js";
import { getPropulsionSnapshot, setPropulsionTarget, takePropulsionCommands, updatePropulsionStatus } from "./propulsion-store.js";
import { getServoSnapshot, setServoTargets, takeServoCommands, updateServoStatus } from "./servo-store.js";
import { runTwinSimulation } from "./twin-simulator.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || "0.0.0.0";
const maxHistory = 180;
const demoWaterFeedEnabled = process.env.UISYS_DEMO_WATER_FEED !== "false";
const demoWaterIntervalMs = Math.max(2000, Number(process.env.UISYS_DEMO_WATER_INTERVAL_MS || 4000));

let waterHistory = createWaterSeries(96);
let batteries = createBatteries();
let latestAiReport: AIReport | null = null;
let demoWaterCursor = waterHistory.length;
let lastDemoWaterAt = Date.now();
let lastRealWaterAt = 0;
const systemLogs: SystemLog[] = [];

app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true }));
app.use(express.json({ limit: "1mb" }));

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
  return entry;
}

appendLog("success", "平台服务已启动", "Express 后端已加载水质、AI、舵机、推进器和日志接口");

function appendDemoWaterIfNeeded() {
  if (!demoWaterFeedEnabled) return;

  const now = Date.now();
  if (now - lastRealWaterAt < 60_000) return;
  if (now - lastDemoWaterAt < demoWaterIntervalMs) return;

  const packet = createDemoWaterSample(waterHistory.at(-1), demoWaterCursor, now);
  demoWaterCursor += 1;
  lastDemoWaterAt = now;
  waterHistory = [...waterHistory, packet].slice(-maxHistory);
}

function currentSnapshot(): PlatformSnapshot {
  appendDemoWaterIfNeeded();
  batteries = createBatteries();
  return {
    water: waterHistory,
    batteries,
    navigation: createNavigation(),
    aiReport: latestAiReport || createAIReport(waterHistory),
    vessel: createVesselStatus(),
  };
}

function waterStatus(turbidity: number, ph: number, dissolvedOxygen: number, ammoniaNitrogen: number): WaterStatus {
  if (turbidity > 65 || ph < 6.4 || ph > 8.8 || dissolvedOxygen < 3.5 || ammoniaNitrogen > 0.5) return "polluted";
  if (turbidity > 48 || ammoniaNitrogen > 0.3) return "algae-risk";
  if (turbidity > 34 || ph < 6.8 || ph > 8.4 || dissolvedOxygen < 5.5 || ammoniaNitrogen > 0.2) return "attention";
  return "normal";
}

function createSimulation(count: number) {
  return createWaterSeries(count);
}

function readNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "fishery-digital-twin-api",
    time: new Date().toISOString(),
    ai: aiStatus(),
    servos: getServoSnapshot(),
    propulsion: getPropulsionSnapshot(),
  });
});

app.get("/api/snapshot", (_req, res) => {
  res.json(currentSnapshot());
});

app.get("/api/water", (_req, res) => {
  appendDemoWaterIfNeeded();
  res.json(waterHistory);
});

app.get("/api/batteries", (_req, res) => {
  batteries = createBatteries();
  res.json(batteries);
});

app.get("/api/navigation", (_req, res) => {
  res.json(createNavigation());
});

app.get("/api/vessel", (_req, res) => {
  res.json(createVesselStatus());
});

app.post("/api/data", (req, res) => {
  const body = req.body || {};
  const latest = waterHistory.at(-1);
  const waterTemperature = readNumber(body.waterTemperature ?? body.water_temperature);
  const turbidity = readNumber(body.turbidity);
  const ph = readNumber(body.ph ?? body.pH);
  const dissolvedOxygen = readNumber(body.dissolvedOxygen ?? body.dissolved_oxygen ?? body.do);
  const ammoniaNitrogen = readNumber(body.ammoniaNitrogen ?? body.ammonia_nitrogen ?? body.nh3);
  const conductivity = readNumber(body.conductivity ?? body.ec);
  const batteryPercent = readNumber(body.batteryPercent ?? body.battery_percent);

  if (
    waterTemperature === null &&
    turbidity === null &&
    ph === null &&
    dissolvedOxygen === null &&
    ammoniaNitrogen === null &&
    conductivity === null &&
    batteryPercent === null
  ) {
    res.status(400).json({
      error: "provide at least one numeric field: waterTemperature, turbidity, ph, dissolvedOxygen, ammoniaNitrogen, conductivity or batteryPercent",
    });
    return;
  }

  const nextTemperature = waterTemperature ?? latest?.waterTemperature ?? 24.5;
  const nextTurbidity = turbidity ?? latest?.turbidity ?? 26;
  const nextPh = ph ?? latest?.ph ?? 7.4;
  const nextDissolvedOxygen = dissolvedOxygen ?? latest?.dissolvedOxygen ?? 6.8;
  const nextAmmoniaNitrogen = ammoniaNitrogen ?? latest?.ammoniaNitrogen ?? 0.08;
  const nextConductivity = conductivity ?? latest?.conductivity ?? 460;

  const packet: WaterData = {
    timestamp: new Date().toISOString(),
    waterTemperature: Number(nextTemperature.toFixed(1)),
    turbidity: Number(nextTurbidity.toFixed(1)),
    ph: Number(nextPh.toFixed(2)),
    dissolvedOxygen: Number(nextDissolvedOxygen.toFixed(1)),
    ammoniaNitrogen: Number(nextAmmoniaNitrogen.toFixed(2)),
    conductivity: Math.round(nextConductivity),
    status: waterStatus(nextTurbidity, nextPh, nextDissolvedOxygen, nextAmmoniaNitrogen),
  };

  waterHistory = [...waterHistory, packet].slice(-maxHistory);
  lastRealWaterAt = Date.now();
  if (batteryPercent !== null) {
    batteries = batteries.map((battery: BatteryData, index) => index === 0
      ? { ...battery, percentage: Math.max(0, Math.min(100, Math.round(batteryPercent))) }
      : battery);
  }

  latestAiReport = null;
  appendLog("info", "传感器数据已接收", `水温 ${packet.waterTemperature}°C，浊度 ${packet.turbidity} NTU，溶解氧 ${packet.dissolvedOxygen} mg/L`, "esp32");
  res.status(201).json({ message: "ok", packet, snapshot: currentSnapshot() });
});

app.post("/api/simulate", (req, res) => {
  const count = Math.max(24, Math.min(240, Number(req.body?.count || 96)));
  waterHistory = createSimulation(count);
  demoWaterCursor = waterHistory.length;
  lastDemoWaterAt = Date.now();
  latestAiReport = null;
  const log = appendLog("info", "模拟数据已生成", `已生成 ${count} 个符合养殖参考范围的水质采样点`, "simulation");
  res.status(201).json({ count, water: waterHistory, snapshot: currentSnapshot(), log });
});

app.get("/api/ai/status", (_req, res) => {
  res.json({
    ...aiStatus(),
    hasReport: latestAiReport !== null,
  });
});

app.get("/api/ai/report", (_req, res) => {
  if (!latestAiReport) {
    res.status(404).json({ message: "No AI report yet" });
    return;
  }
  res.json(latestAiReport);
});

app.post("/api/ai/report", async (_req, res) => {
  try {
    latestAiReport = await generateDecisionReport(waterHistory, batteries);
    const log = appendLog("success", "AI 预测报告已生成", `${latestAiReport.title} · ${latestAiReport.sampleCount} 个采样点`, latestAiReport.model);
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

app.post("/api/servos", (req, res) => {
  try {
    const result = setServoTargets(req.body || {});
    appendLog(
      "info",
      "舵机命令已下发",
      `${result.command.device_id}: ${result.command.angles.map((angle, index) => `S${index + 1} ${angle}°`).join(" / ")}`,
      result.command.device_id,
    );
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "invalid servo request" });
  }
});

app.post("/api/servos/status", (req, res) => {
  try {
    const result = updateServoStatus(req.body || {});
    appendLog("success", "舵机控制板在线", result.device.device_id, result.device.device_id);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "invalid servo status" });
  }
});

app.get("/api/device/commands", (req, res) => {
  const deviceId = typeof req.query.device_id === "string" ? req.query.device_id : undefined;
  res.json(takeServoCommands(deviceId));
});

app.get("/api/propulsion", (req, res) => {
  const deviceId = typeof req.query.device_id === "string" ? req.query.device_id : undefined;
  res.json(getPropulsionSnapshot(deviceId));
});

app.post("/api/propulsion", (req, res) => {
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

app.post("/api/propulsion/status", (req, res) => {
  try {
    const result = updatePropulsionStatus(req.body || {});
    appendLog("success", "推进控制板在线", result.device.device_id, result.device.device_id);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "invalid propulsion status" });
  }
});

app.get("/api/propulsion/commands", (req, res) => {
  const deviceId = typeof req.query.device_id === "string" ? req.query.device_id : undefined;
  res.json(takePropulsionCommands(deviceId));
});

app.post("/api/twin/simulate", (req, res) => {
  try {
    const result = runTwinSimulation(
      (req.body || {}) as Partial<TwinSimulationInput>,
      currentSnapshot(),
      getServoSnapshot() as ServoSnapshot,
      getPropulsionSnapshot() as PropulsionSnapshot,
    );
    appendLog(
      "info",
      "数字孪生推演已完成",
      `航线 ${result.route.distanceKm} km · ${result.fault.title} · 健康度 ${result.fatigue.overallHealth}%`,
      result.modelVersion,
    );
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "twin simulation failed";
    appendLog("error", "数字孪生推演失败", message, "twin-simulator");
    res.status(400).json({ error: message });
  }
});

app.get("/api/logs", (_req, res) => {
  res.json(systemLogs);
});

app.listen(port, host, () => {
  console.log(`Fishery digital twin API listening on http://${host}:${port}`);
  console.log(`Local API: http://localhost:${port}`);
  console.log(`ESP32 servo command endpoint: http://<computer-ip>:${port}/api/device/commands?device_id=servo-quad-01`);
  console.log(`MKS FOC command endpoint: http://<computer-ip>:${port}/api/propulsion/commands?device_id=mks-foc-dual-01`);
});
