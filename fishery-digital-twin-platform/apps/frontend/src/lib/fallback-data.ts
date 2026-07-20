import type { AIReport, BatteryData, NavigationData, PlatformSnapshot, VesselStatus, WaterData, WaterStatus } from "@fishery/shared";

const route = [
  { lat: 35.9959, lng: 120.2248, label: "起航点" },
  { lat: 35.9984, lng: 120.2292, label: "采样点 A" },
  { lat: 36.0022, lng: 120.2266, label: "采样点 B" },
  { lat: 36.0045, lng: 120.2324, label: "采样点 C" },
  { lat: 36.0004, lng: 120.2361, label: "返航点" },
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
  const eventIndex = Math.min(count - 1, Math.max(1, Math.round(Math.min(60, count * 0.62))));
  const minutesAfterFeed = Math.max(0, index - eventIndex);
  const feedActive = index >= eventIndex ? 1 : 0;
  const feedTurbidity = feedActive * 4.2 * Math.exp(-minutesAfterFeed / 92);
  const feedAmmonia = feedActive * 0.018 * (1 - Math.exp(-minutesAfterFeed / 80));
  const turbidityLightBlock = feedActive * Math.min(0.18, feedTurbidity * 0.035);
  const tempRise = Math.min(0.85, 0.35 * durationHours);
  const phRise = Math.min(0.32, 0.125 * durationHours);
  const doRise = Math.min(2.05, 0.9 * durationHours);

  const waterTemperature = 25 + tempRise * daylight + deterministicNoise(index, 1) * 0.012;
  const turbidity = 28 + feedTurbidity - feedActive * minutesAfterFeed * 0.006 + deterministicNoise(index, 2) * 0.14;
  const ph = 7.6 + phRise * daylight + deterministicNoise(index, 3) * 0.004;
  const dissolvedOxygen = 7 + doRise * daylight - tempRise * daylight * 0.12 - turbidityLightBlock + deterministicNoise(index, 4) * 0.025;
  const ammoniaNitrogen = 0.15 - daylight * 0.012 + feedAmmonia + deterministicNoise(index, 5) * 0.002;
  const conductivity = 500 + progress * 1.2 + deterministicNoise(index, 6) * 0.42;

  return {
    waterTemperature: clamp(waterTemperature, 22, 32),
    turbidity: clamp(turbidity, 10, 50),
    ph: clamp(ph, 7, 8.5),
    dissolvedOxygen: clamp(dissolvedOxygen, 5, 12),
    ammoniaNitrogen: clamp(ammoniaNitrogen, 0.05, 0.3),
    conductivity: clamp(conductivity, 200, 1000),
  };
}

export function createWaterData(count = 36, baseTime = INITIAL_MOCK_TIME): WaterData[] {
  return Array.from({ length: count }, (_, index) => {
    const point = realisticWaterPoint(index, count);
    return {
      timestamp: new Date(baseTime - (count - index - 1) * 60_000).toISOString(),
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
  return [
    { id: "A", percentage: 86, voltage: 12.4, status: "online" },
    { id: "B", percentage: 73, voltage: 11.9, status: "online" },
    { id: "C", percentage: 61, voltage: 11.5, status: "warning" },
  ];
}

export function createNavigation(baseTime = INITIAL_MOCK_TIME): NavigationData {
  return {
    position: { lat: 35.9984, lng: 120.2292, label: "近海巡检船", timestamp: new Date(baseTime).toISOString() },
    route,
    targetWaypoint: route[2],
    speed: 1.86,
    heading: 74,
    remainingDistance: 1.24,
    etaMinutes: 18,
  };
}

export function createVesselStatus(): VesselStatus {
  return {
    vesselName: "智慧渔业巡检船",
    online: true,
    mission: "巡检中",
    aiReady: true,
    pixhawk: "online",
    esp32: "online",
    communication: "online",
    sensor: "online",
    fishHoldPercentage: 42,
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
    summary: "当前水域整体状态良好，浊度较上一周期略有升高，未来 12 小时藻华风险较低，建议维持当前巡检频率。",
    findings: [
      `当前水温 ${latest.waterTemperature.toFixed(1)}°C，处于温水性淡水养殖参考范围。`,
      `浊度 ${latest.turbidity.toFixed(1)} NTU，存在轻微上升趋势。`,
      `pH ${latest.ph.toFixed(2)}，未触发酸碱异常预警。`,
      `溶解氧 ${latest.dissolvedOxygen.toFixed(1)} mg/L，氨氮 ${latest.ammoniaNitrogen.toFixed(2)} mg/L，处于演示参考范围内。`,
    ],
    recommendations: ["保持当前巡检航线。", "持续关注浊度上升区域。", "关键采样点建议人工复核。"],
    dataQuality: `样本数量 ${water.length} 个，时间间隔连续；当前为前端离线 Mock 数据。`,
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
    water,
    batteries: createBatteries(),
    navigation: createNavigation(baseTime),
    aiReport: createAIReport(water, baseTime),
    vessel: createVesselStatus(),
  };
}
