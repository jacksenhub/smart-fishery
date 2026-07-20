import type {
  AIReport,
  BatteryData,
  NavigationData,
  PlatformSnapshot,
  VesselStatus,
  WaterData,
  WaterStatus,
} from "@fishery/shared";

const baseRoute = [
  { lat: 35.9959, lng: 120.2248, label: "起航点" },
  { lat: 35.9984, lng: 120.2292, label: "采样点 A" },
  { lat: 36.0022, lng: 120.2266, label: "采样点 B" },
  { lat: 36.0045, lng: 120.2324, label: "采样点 C" },
  { lat: 36.0004, lng: 120.2361, label: "返航点" },
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

function formatWaterPoint(point: ReturnType<typeof realisticWaterPoint>, timestamp: number): WaterData {
  return {
    timestamp: new Date(timestamp).toISOString(),
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
  return [
    { id: "A", percentage: Math.round(86 + wave(9000, 3)), voltage: 12.4, status: "online" },
    { id: "B", percentage: Math.round(73 + wave(11000, 4, 2)), voltage: 11.9, status: "online" },
    { id: "C", percentage: Math.round(61 + wave(13000, 5, 4)), voltage: 11.5, status: "warning" },
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
    label: "近海巡检船",
    timestamp: new Date().toISOString(),
  };

  return {
    position,
    route: baseRoute,
    targetWaypoint: next,
    speed: Number((1.8 + wave(7000, 0.35)).toFixed(2)),
    heading: Math.round((phase / baseRoute.length) * 360),
    remainingDistance: Number((1.6 - ratio * 0.24).toFixed(2)),
    etaMinutes: Math.max(6, Math.round(28 - phase * 3)),
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
    fishHoldPercentage: Math.round(42 + wave(10000, 3)),
  };
}

export function createAIReport(water = createWaterSeries()): AIReport {
  const latest = water.at(-1)!;
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
    id: `mock-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    status,
    riskLevel,
    title: titleMap[status],
    summary: "当前水域整体处于可控状态，水温维持在常见淡水温水性养殖参考范围内，浊度存在轻微上行趋势，建议继续观察重点采样点。",
    findings: [
      `当前水温 ${latest.waterTemperature.toFixed(1)}°C，处于温水性淡水养殖参考范围。`,
      `浊度 ${latest.turbidity.toFixed(1)} NTU，存在轻微上升趋势。`,
      `pH ${latest.ph.toFixed(2)}，未触发酸碱异常预警。`,
      `溶解氧 ${latest.dissolvedOxygen.toFixed(1)} mg/L，氨氮 ${latest.ammoniaNitrogen.toFixed(2)} mg/L，处于演示参考范围内。`,
    ],
    recommendations: [
      "保持当前巡检航线，优先覆盖浊度上升区域。",
      "若浊度连续 3 个周期上升，建议增加人工采样复核。",
      "比赛展示阶段可开启航迹回放，突出数字孪生监测能力。",
    ],
    dataQuality: `样本数量 ${water.length} 个，时间间隔连续，适合用于趋势判断；当前仍为 Mock 数据，接入真实传感器后可替换为实时采样。`,
    confidence: 0.86,
    sampleCount: water.length,
    model: "local-predictive-baseline",
    forecast: {
      horizonHours: 12,
      algaeRisk: status === "algae-risk" ? "medium" : status === "polluted" ? "high" : "low",
      turbidityTrend,
      batteryRuntimeHours: 4.6,
    },
  };
}

export function createSnapshot(): PlatformSnapshot {
  const water = createWaterSeries();
  return {
    water,
    batteries: createBatteries(),
    navigation: createNavigation(),
    aiReport: createAIReport(water),
    vessel: createVesselStatus(),
  };
}
