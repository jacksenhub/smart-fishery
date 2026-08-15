import type { AIReport, BatteryData, NavigationData, PlatformSnapshot, VesselStatus, WaterData, WaterStatus } from "@fishery/shared";

// 北理珠月牙湖（读书岛西南侧）巡航路线，坐标采用 WGS84。
const route = [
  { lat: 22.36813, lng: 113.53784, label: "月牙湖起航点" },
  { lat: 22.36802, lng: 113.53796, label: "西北侧采样点" },
  { lat: 22.368, lng: 113.53838, label: "湖心监测点" },
  { lat: 22.36802, lng: 113.53867, label: "东侧采样点" },
  { lat: 22.3679, lng: 113.53856, label: "东南侧采样点" },
  { lat: 22.36786, lng: 113.53844, label: "南侧采样点" },
  { lat: 22.368, lng: 113.5382, label: "水质复测点" },
  { lat: 22.368, lng: 113.53802, label: "返航航点" },
];

const INITIAL_MOCK_TIME = Date.parse("2026-01-01T08:00:00.000Z");

function statusOf(turbidity: number, ph: number, dissolvedOxygen: number, ammoniaNitrogen: number): WaterStatus {
  if (turbidity > 65 || ph < 6.4 || ph > 8.8 || dissolvedOxygen < 3.5 || ammoniaNitrogen > 0.5) return "polluted";
  if (turbidity > 48 || ammoniaNitrogen > 0.3) return "algae-risk";
  if (turbidity > 34 || ph < 6.8 || ph > 8.4 || dissolvedOxygen < 5.5 || ammoniaNitrogen > 0.2) return "attention";
  return "normal";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(value: number) {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function deterministicNoise(index: number, salt: number) {
  const raw = Math.sin((index + 1) * (12.9898 + salt) + salt * 78.233) * 43758.5453;
  return (raw - Math.floor(raw)) * 2 - 1;
}

function realisticWaterPoint(index: number, count: number) {
  const progress = count <= 1 ? 0 : index / (count - 1);
  const durationHours = Math.max(0.25, (count - 1) / 60);
  const daylight = smoothstep(progress);
  const runoffIndex = Math.min(count - 1, Math.max(1, Math.round(Math.min(90, count * 0.64))));
  const minutesAfterRunoff = Math.max(0, index - runoffIndex);
  const runoffActive = index >= runoffIndex ? 1 : 0;
  const runoffPulse = runoffActive * Math.exp(-minutesAfterRunoff / 105);
  const tempRise = Math.min(0.72, 0.3 * durationHours);
  const phRise = Math.min(0.18, 0.075 * durationHours);
  const oxygenRise = Math.min(1.15, 0.48 * durationHours);

  const waterTemperature = 28.1 + tempRise * daylight + deterministicNoise(index, 1) * 0.018;
  const turbidity = 17.8 + runoffPulse * 4.8 + deterministicNoise(index, 2) * 0.18;
  const ph = 7.42 + phRise * daylight + deterministicNoise(index, 3) * 0.006;
  const dissolvedOxygen = 6.55 + oxygenRise * daylight - runoffPulse * 0.12 - tempRise * daylight * 0.08 + deterministicNoise(index, 4) * 0.03;
  const ammoniaNitrogen = 0.08 + runoffPulse * 0.012 - daylight * 0.006 + deterministicNoise(index, 5) * 0.0015;
  const conductivity = 365 + progress * 2.4 + runoffPulse * 2.1 + deterministicNoise(index, 6) * 0.55;

  return {
    waterTemperature: clamp(waterTemperature, 24, 32),
    turbidity: clamp(turbidity, 8, 32),
    ph: clamp(ph, 7, 8.2),
    dissolvedOxygen: clamp(dissolvedOxygen, 5.5, 9.5),
    ammoniaNitrogen: clamp(ammoniaNitrogen, 0.03, 0.18),
    conductivity: clamp(conductivity, 250, 650),
  };
}

export function createWaterData(count = 36, baseTime = INITIAL_MOCK_TIME): WaterData[] {
  return Array.from({ length: count }, (_, index) => {
    const point = realisticWaterPoint(index, count);
    return {
      timestamp: new Date(baseTime - (count - index - 1) * 60_000).toISOString(),
      source: "fallback",
      waterTemperature: Number(point.waterTemperature.toFixed(1)),
      turbidity: Number(point.turbidity.toFixed(1)),
      ph: Number(point.ph.toFixed(2)),
      dissolvedOxygen: Number(point.dissolvedOxygen.toFixed(1)),
      ammoniaNitrogen: Number(point.ammoniaNitrogen.toFixed(2)),
      conductivity: Math.round(point.conductivity),
      status: statusOf(point.turbidity, point.ph, point.dissolvedOxygen, point.ammoniaNitrogen),
    };
  });
}

export function createBatteries(): BatteryData[] {
  const lastUpdatedAt = new Date(INITIAL_MOCK_TIME).toISOString();
  return [
    { id: "A", percentage: 0, voltage: 0, status: "offline", source: "fallback", lastUpdatedAt },
    { id: "B", percentage: 0, voltage: 0, status: "offline", source: "fallback", lastUpdatedAt },
    { id: "C", percentage: 0, voltage: 0, status: "offline", source: "fallback", lastUpdatedAt },
  ];
}

export function createNavigation(baseTime = INITIAL_MOCK_TIME): NavigationData {
  return {
    position: { lat: 22.36802, lng: 113.53796, label: "月牙湖巡检船", timestamp: new Date(baseTime).toISOString() },
    route,
    targetWaypoint: route[2],
    speed: 1.05,
    heading: 93,
    remainingDistance: 0.168,
    etaMinutes: 3,
    source: "mock",
  };
}

export function createVesselStatus(): VesselStatus {
  return {
    vesselName: "智慧渔业巡检船",
    online: false,
    mission: "待命",
    aiReady: false,
    pixhawk: "offline",
    esp32: "offline",
    communication: "offline",
    sensor: "offline",
    fishHoldPercentage: 0,
  };
}

export function createAIReport(water = createWaterData(), baseTime = INITIAL_MOCK_TIME): AIReport {
  const latest = water.at(-1)!;
  const turbidityChange = water.length > 1 ? latest.turbidity - water[0].turbidity : 0;
  const turbidityTrend = turbidityChange > 4 ? "rising" : turbidityChange < -4 ? "falling" : "stable";
  const riskLevel = latest.status === "polluted" || latest.status === "algae-risk" ? "warning" : latest.status === "attention" ? "attention" : "normal";
  return {
    id: "local-mock",
    generatedAt: new Date(baseTime).toISOString(),
    status: latest.status,
    riskLevel,
    title: latest.status === "normal" ? "水域状态稳定" : "水质趋势需关注",
    summary: "当前月牙湖校园景观水体整体稳定，各项指标处于日常巡检参考范围，岸边径流可能带来短时浊度波动，建议维持当前巡检频率。",
    findings: [
      `当前水温 ${latest.waterTemperature.toFixed(1)}°C，处于校园景观湖季节性常见区间。`,
      `浊度 ${latest.turbidity.toFixed(1)} NTU，整体保持清澈，短时变化可能来自岸边径流或船体扰动。`,
      `pH ${latest.ph.toFixed(2)}，未触发酸碱异常预警。`,
      `溶解氧 ${latest.dissolvedOxygen.toFixed(1)} mg/L，氨氮 ${latest.ammoniaNitrogen.toFixed(2)} mg/L，处于校园湖泊巡检参考范围内。`,
    ],
    recommendations: ["保持月牙湖当前巡检航线。", "重点覆盖湖心、岸边和排水口附近水域。", "降雨后增加一次人工采样复核。"],
    dataQuality: `样本数量 ${water.length} 个，时间间隔连续，采用月牙湖校园景观水体特征生成；当前为前端离线 Mock 数据。`,
    confidence: 0.86,
    sampleCount: water.length,
    model: "local-predictive-baseline",
    forecast: {
      horizonHours: 12,
      algaeRisk: latest.status === "algae-risk" ? "medium" : latest.status === "polluted" ? "high" : "low",
      turbidityTrend,
      batteryRuntimeHours: 4.6,
    },
  };
}

export function createSnapshot(baseTime = INITIAL_MOCK_TIME): PlatformSnapshot {
  const water = createWaterData(36, baseTime);
  return {
    generatedAt: new Date(baseTime).toISOString(),
    dataMode: "fallback",
    water,
    batteries: createBatteries(),
    navigation: createNavigation(baseTime),
    aiReport: createAIReport(water, baseTime),
    vessel: createVesselStatus(),
  };
}
