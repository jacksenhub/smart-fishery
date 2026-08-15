import type {
  AIReport,
  BatteryData,
  NavigationData,
  PlatformSnapshot,
  VesselStatus,
  WaterData,
  WaterStatus,
} from "@fishery/shared";

// 北理珠月牙湖（读书岛西南侧）巡航路线，坐标采用 WGS84。
const baseRoute = [
  { lat: 22.36813, lng: 113.53784, label: "月牙湖起航点" },
  { lat: 22.36802, lng: 113.53796, label: "西北侧采样点" },
  { lat: 22.368, lng: 113.53838, label: "湖心监测点" },
  { lat: 22.36802, lng: 113.53867, label: "东侧采样点" },
  { lat: 22.3679, lng: 113.53856, label: "东南侧采样点" },
  { lat: 22.36786, lng: 113.53844, label: "南侧采样点" },
  { lat: 22.368, lng: 113.5382, label: "水质复测点" },
  { lat: 22.368, lng: 113.53802, label: "返航航点" },
];

function wave(seed: number, range: number, offset = 0) {
  return Math.sin(Date.now() / seed + offset) * range;
}

function waterStatus(turbidity: number, ph: number, dissolvedOxygen: number, ammoniaNitrogen: number): WaterStatus {
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

  // 北理珠月牙湖校园景观水体：整体清洁、弱碱性，短时岸边径流造成轻微浊度波动。
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

function formatWaterPoint(
  point: ReturnType<typeof realisticWaterPoint>,
  timestamp: number,
  source: WaterData["source"] = "demo",
): WaterData {
  return {
    timestamp: new Date(timestamp).toISOString(),
    source,
    waterTemperature: Number(point.waterTemperature.toFixed(1)),
    turbidity: Number(point.turbidity.toFixed(1)),
    ph: Number(point.ph.toFixed(2)),
    dissolvedOxygen: Number(point.dissolvedOxygen.toFixed(1)),
    ammoniaNitrogen: Number(point.ammoniaNitrogen.toFixed(2)),
    conductivity: Math.round(point.conductivity),
    status: waterStatus(point.turbidity, point.ph, point.dissolvedOxygen, point.ammoniaNitrogen),
  };
}

function stepToward(current: number, target: number, maxStep: number) {
  return current + clamp(target - current, -maxStep, maxStep);
}

function bearingBetween(
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
) {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const startLat = toRadians(start.lat);
  const endLat = toRadians(end.lat);
  const deltaLng = toRadians(end.lng - start.lng);
  const y = Math.sin(deltaLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat)
    - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng);
  return Math.round((Math.atan2(y, x) * 180 / Math.PI + 360) % 360);
}

export function createWaterSeries(count = 36): WaterData[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => {
    const point = realisticWaterPoint(index, count);
    return formatWaterPoint(point, now - (count - index - 1) * 60_000);
  });
}

export function createWaterSample(sequence: number, timestamp = Date.now(), cycleLength = 240): WaterData {
  return formatWaterPoint(realisticWaterPoint(sequence % cycleLength, cycleLength), timestamp);
}

export function createDemoWaterSample(previous: WaterData | undefined, sequence: number, timestamp = Date.now()): WaterData {
  if (!previous) return createWaterSample(sequence, timestamp);

  const target = realisticWaterPoint(sequence % 240, 240);
  const point = {
    waterTemperature: stepToward(previous.waterTemperature, target.waterTemperature, 0.025),
    turbidity: stepToward(previous.turbidity, target.turbidity, 0.45),
    ph: stepToward(previous.ph, target.ph, 0.01),
    dissolvedOxygen: stepToward(previous.dissolvedOxygen ?? 6.8, target.dissolvedOxygen, 0.08),
    ammoniaNitrogen: stepToward(previous.ammoniaNitrogen ?? 0.08, target.ammoniaNitrogen, 0.006),
    conductivity: stepToward(previous.conductivity ?? 500, target.conductivity, 1.2),
  };

  return formatWaterPoint(point, timestamp);
}

export function createBatteries(): BatteryData[] {
  const lastUpdatedAt = new Date().toISOString();
  return [
    { id: "A", percentage: Math.round(86 + wave(9000, 3)), voltage: 12.4, status: "warning", source: "demo", lastUpdatedAt },
    { id: "B", percentage: Math.round(73 + wave(11000, 4, 2)), voltage: 11.9, status: "warning", source: "demo", lastUpdatedAt },
    { id: "C", percentage: Math.round(61 + wave(13000, 5, 4)), voltage: 11.5, status: "warning", source: "demo", lastUpdatedAt },
  ];
}

export function createNavigation(): NavigationData {
  const phase = (Date.now() / 15000) % baseRoute.length;
  const index = Math.floor(phase);
  const next = baseRoute[(index + 1) % baseRoute.length];
  const current = baseRoute[index];
  const ratio = phase - index;
  const position = {
    lat: current.lat + (next.lat - current.lat) * ratio,
    lng: current.lng + (next.lng - current.lng) * ratio,
    label: "月牙湖巡检船",
    timestamp: new Date().toISOString(),
  };
  const speed = Number((1.05 + wave(7000, 0.12)).toFixed(2));
  const progress = (index + ratio) / baseRoute.length;
  const remainingDistance = Math.max(0, 0.192 * (1 - progress));

  return {
    position,
    route: baseRoute,
    targetWaypoint: next,
    speed,
    heading: bearingBetween(current, next),
    remainingDistance: Number(remainingDistance.toFixed(3)),
    etaMinutes: Math.max(0, Math.ceil(remainingDistance * 1000 / Math.max(speed, 0.1) / 60)),
  };
}

export function createVesselStatus(): VesselStatus {
  return {
    vesselName: "智慧渔业巡检船",
    online: false,
    mission: "待命",
    aiReady: true,
    pixhawk: "offline",
    esp32: "offline",
    communication: "offline",
    sensor: "offline",
    fishHoldPercentage: 0,
  };
}

export function createAIReport(water = createWaterSeries()): AIReport {
  const latest = water.at(-1)!;
  const sources = new Set(water.map((point) => point.source));
  const sourceMode = sources.size > 1 ? "mixed" : sources.has("sensor") ? "live" : "demo";
  const status = latest.status;
  const turbidityChange = water.length > 1 ? latest.turbidity - water[0].turbidity : 0;
  const turbidityTrend = turbidityChange > 4 ? "rising" : turbidityChange < -4 ? "falling" : "stable";
  const riskLevel = status === "polluted" || status === "algae-risk" ? "warning" : status === "attention" ? "attention" : "normal";
  const titleMap: Record<WaterStatus, string> = {
    normal: "水域状态稳定",
    attention: "浊度轻微升高",
    polluted: "污染风险升高",
    "algae-risk": "藻华风险关注",
  };

  return {
    id: `local-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    status,
    riskLevel,
    title: titleMap[status],
    summary: sourceMode === "live"
      ? `本地基线根据当前真实传感器样本判断水质状态为“${titleMap[status]}”。该结果用于现场快速参考，重要决策仍应结合连续采样和人工复核。`
      : sourceMode === "mixed"
        ? `当前样本同时包含真实与演示来源，趋势结论仅供参考。最新状态判断为“${titleMap[status]}”。`
        : `当前为独立演示数据，本地基线判断状态为“${titleMap[status]}”，不得作为真实水域检测结论。`,
    findings: [
      `当前水温 ${latest.waterTemperature.toFixed(1)}°C。`,
      `浊度 ${latest.turbidity.toFixed(1)} NTU，趋势为${turbidityTrend === "rising" ? "上升" : turbidityTrend === "falling" ? "下降" : "稳定"}。`,
      `pH ${latest.ph.toFixed(2)}，当前状态为${latest.ph >= 6.8 && latest.ph <= 8.4 ? "参考范围内" : "需复核"}。`,
      `溶解氧 ${latest.dissolvedOxygen.toFixed(1)} mg/L，氨氮 ${latest.ammoniaNitrogen.toFixed(2)} mg/L。`,
    ],
    recommendations: [
      "保持固定采样路线和时间间隔，以便比较连续趋势。",
      "若浊度连续 3 个周期上升，建议增加人工采样复核。",
      "降雨后建议增加一次复测，对比岸边径流前后的水质变化。",
    ],
    dataQuality: sourceMode === "live"
      ? `包含 ${water.length} 个真实传感器样本；来源已标记，尚未校验传感器标定证书与人工对照样本。`
      : sourceMode === "mixed"
        ? `包含 ${water.length} 个混合来源样本；真实与演示数据不可用于同一趋势结论。`
        : `包含 ${water.length} 个演示样本；数据由本地生成器创建，仅用于界面和流程验证。`,
    confidence: Math.min(0.9, 0.55 + water.length / 500),
    sampleCount: water.length,
    model: "local-predictive-baseline",
    forecast: {
      horizonHours: 12,
      algaeRisk: status === "algae-risk" ? "medium" : status === "polluted" ? "high" : "low",
      turbidityTrend,
      batteryRuntimeHours: 0,
    },
  };
}

export function createSnapshot(): PlatformSnapshot {
  const water = createWaterSeries();
  return {
    generatedAt: new Date().toISOString(),
    dataMode: "demo",
    water,
    batteries: createBatteries(),
    navigation: createNavigation(),
    aiReport: createAIReport(water),
    vessel: createVesselStatus(),
  };
}
