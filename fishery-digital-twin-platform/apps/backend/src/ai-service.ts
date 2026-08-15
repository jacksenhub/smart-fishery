import type { AIReport, BatteryData, WaterData, WaterStatus } from "@fishery/shared";
import { createAIReport } from "./mock-data.js";

interface AnalysisStats {
  latest: WaterData;
  sampleCount: number;
  temperature: NumberStats;
  turbidity: NumberStats;
  ph: NumberStats;
  dissolvedOxygen: NumberStats;
  ammoniaNitrogen: NumberStats;
  conductivity: NumberStats;
  batteryAverage: number;
}

interface NumberStats {
  latest: number;
  minimum: number;
  maximum: number;
  average: number;
  change: number;
}

const aquacultureReference = {
  waterTemperature: "常见淡水温水性鱼类一般适宜水温约 22-30°C，短时波动需结合鱼种判断。",
  turbidity: "浊度低于 30 NTU 通常较清，30-50 NTU 需观察，持续高于 50 NTU 建议复核水体扰动或污染来源。",
  ph: "常见淡水养殖参考 pH 约 6.8-8.5，超出区间需要关注应激风险。",
  dissolvedOxygen: "淡水养殖通常建议溶解氧保持在 5 mg/L 以上，低于 4 mg/L 应重点关注缺氧风险。",
  ammoniaNitrogen: "氨氮建议尽量低于 0.2 mg/L，持续升高时需要排查残饵、排泄物或换水条件。",
  conductivity: "淡水养殖电导率常见参考约 200-800 μS/cm，异常突变可能提示水源或盐分变化。",
};

function numberStats(values: number[]): NumberStats {
  return {
    latest: values.at(-1) ?? 0,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    average: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
    change: Number(((values.at(-1) ?? 0) - values[0]).toFixed(2)),
  };
}

function statusToRisk(status: WaterStatus): AIReport["riskLevel"] {
  if (status === "polluted" || status === "algae-risk") return "warning";
  if (status === "attention") return "attention";
  return "normal";
}

function analyzeStats(water: WaterData[], batteries: BatteryData[]): AnalysisStats {
  const safeWater = water.length ? water : [{
    timestamp: new Date().toISOString(),
    source: "fallback" as const,
    waterTemperature: 24.5,
    turbidity: 28,
    ph: 7.4,
    dissolvedOxygen: 6.8,
    ammoniaNitrogen: 0.08,
    conductivity: 460,
    status: "normal" as WaterStatus,
  }];

  return {
    latest: safeWater.at(-1)!,
    sampleCount: safeWater.length,
    temperature: numberStats(safeWater.map((item) => item.waterTemperature)),
    turbidity: numberStats(safeWater.map((item) => item.turbidity)),
    ph: numberStats(safeWater.map((item) => item.ph)),
    dissolvedOxygen: numberStats(safeWater.map((item) => item.dissolvedOxygen)),
    ammoniaNitrogen: numberStats(safeWater.map((item) => item.ammoniaNitrogen)),
    conductivity: numberStats(safeWater.map((item) => item.conductivity)),
    batteryAverage: Number((batteries.reduce((sum, item) => sum + item.percentage, 0) / Math.max(1, batteries.length)).toFixed(1)),
  };
}

function localReport(water: WaterData[], batteries: BatteryData[]): AIReport {
  const base = createAIReport(water);
  const stats = analyzeStats(water, batteries);
  const risingTurbidity = stats.turbidity.change > 6;
  const lowOxygen = stats.dissolvedOxygen.latest < 5;
  const risingAmmonia = stats.ammoniaNitrogen.latest > 0.2 || stats.ammoniaNitrogen.change > 0.08;
  const lowBattery = stats.batteryAverage < 45;
  const riskLevel: AIReport["riskLevel"] = lowBattery || base.status === "polluted"
    ? "warning"
    : risingTurbidity || lowOxygen || risingAmmonia || base.status !== "normal"
      ? "attention"
      : "normal";

  return {
    ...base,
    id: `local-ai-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    riskLevel,
    title: riskLevel === "warning" ? "水域巡检风险升高" : riskLevel === "attention" ? "水质趋势需要关注" : "水域状态稳定",
    summary: risingTurbidity || lowOxygen || risingAmmonia
      ? "最近一段时间部分水质指标出现波动，建议结合采样点位置复查浊度、溶解氧和氨氮变化。"
      : "当前水温、浊度、pH、溶解氧、氨氮与电导率整体稳定，短时藻华风险较低，可维持现有巡检频率并持续记录趋势。",
    findings: [
      `水温最新 ${stats.temperature.latest.toFixed(1)}°C，均值 ${stats.temperature.average.toFixed(1)}°C，符合常见淡水养殖参考范围。`,
      `浊度最新 ${stats.turbidity.latest.toFixed(1)} NTU，较周期初变化 ${stats.turbidity.change.toFixed(1)} NTU。`,
      `pH 最新 ${stats.ph.latest.toFixed(2)}，整体处于 ${aquacultureReference.ph}`,
      `溶解氧最新 ${stats.dissolvedOxygen.latest.toFixed(1)} mg/L，氨氮最新 ${stats.ammoniaNitrogen.latest.toFixed(2)} mg/L。`,
      `电导率最新 ${stats.conductivity.latest.toFixed(0)} μS/cm，较周期初变化 ${stats.conductivity.change.toFixed(0)} μS/cm。`,
      `电池平均电量 ${stats.batteryAverage.toFixed(0)}%，${lowBattery ? "需要安排补能或返航预案" : "可支持继续巡检"}。`,
    ],
    recommendations: [
      risingTurbidity ? "优先复查浊度上升采样点，排除泥沙扰动或传感器污染。" : "保持当前巡检航线，继续采集连续趋势数据。",
      lowOxygen ? "溶解氧偏低时，建议降低投喂强度并安排增氧或换水检查。" : "继续观察溶解氧与氨氮的组合变化，避免单点误判。",
      risingAmmonia ? "氨氮升高时，建议复查残饵、排泄物堆积和水体交换情况。" : "将水温、浊度、pH、溶解氧、氨氮与实际养殖鱼种阈值绑定，后续报告会更准确。",
      lowBattery ? "降低非必要舵机动作频率，并预留返航电量。" : "比赛演示时可展示 12 小时趋势预测和设备在线状态。",
    ],
    dataQuality: `本次报告基于 ${stats.sampleCount} 个连续采样点生成。当前数据来源为平台 Mock/实时接口，接入 ESP32 后会自动使用真实数据。`,
    sampleCount: stats.sampleCount,
    model: "local-predictive-baseline",
    confidence: riskLevel === "normal" ? 0.88 : 0.82,
    forecast: {
      horizonHours: 12,
      algaeRisk: base.status === "algae-risk" || stats.turbidity.latest > 50 ? "medium" : "low",
      turbidityTrend: stats.turbidity.change > 4 ? "rising" : stats.turbidity.change < -4 ? "falling" : "stable",
      batteryRuntimeHours: Number(Math.max(1.2, stats.batteryAverage / 18).toFixed(1)),
    },
  };
}

function pickStringList(value: unknown, fallback: string[], limit: number) {
  if (!Array.isArray(value)) return fallback;
  const rows = value.map((item) => String(item).trim()).filter(Boolean);
  return rows.length ? rows.slice(0, limit) : fallback;
}

function parseJsonContent(content: string) {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(trimmed) as Record<string, unknown>;
}

function normalizeDeepSeekReport(raw: Record<string, unknown>, fallback: AIReport, model: string): AIReport {
  const riskLevel = raw.riskLevel || raw.risk_level;
  const normalizedRisk: AIReport["riskLevel"] =
    riskLevel === "normal" || riskLevel === "attention" || riskLevel === "warning"
      ? riskLevel
      : fallback.riskLevel;

  return {
    ...fallback,
    id: `deepseek-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    riskLevel: normalizedRisk,
    title: String(raw.title || fallback.title).slice(0, 42),
    summary: String(raw.summary || fallback.summary),
    findings: pickStringList(raw.findings, fallback.findings, 6),
    recommendations: pickStringList(raw.recommendations, fallback.recommendations, 8),
    dataQuality: String(raw.dataQuality || raw.data_quality || fallback.dataQuality),
    model,
    confidence: (() => {
      const value = Number(raw.confidence ?? fallback.confidence);
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback.confidence;
    })(),
  };
}

export function aiStatus() {
  return {
    configured: Boolean(process.env.DEEPSEEK_API_KEY),
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
  };
}

export async function generateDecisionReport(water: WaterData[], batteries: BatteryData[]) {
  const fallback = localReport(water, batteries);
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return fallback;
  }

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const stats = analyzeStats(water, batteries);
  const timeoutSeconds = Number(process.env.DEEPSEEK_TIMEOUT_SECONDS || 45);
  const timeoutMs = Math.max(5_000, Math.min(120_000, Number.isFinite(timeoutSeconds) ? timeoutSeconds * 1000 : 45_000));

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "你是智慧渔业水质监测辅助决策专家。只依据传感器统计数据分析，输出严格 JSON，不要 Markdown。",
        },
        {
          role: "user",
          content: JSON.stringify({
            task: "生成智慧渔业巡检船水质预测与辅助决策报告",
            required_schema: {
              riskLevel: "normal | attention | warning",
              title: "不超过20字",
              summary: "一段简洁结论",
              findings: ["2至4条关键发现"],
              recommendations: ["2至5条行动建议"],
              dataQuality: "数据质量说明",
              confidence: "0到1之间的小数",
            },
            aquacultureReference,
            stats,
            recentSamples: water.slice(-20),
            batteries,
          }),
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 1200,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`DeepSeek API 返回 ${response.status}: ${detail.slice(0, 220)}`);
  }

  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("DeepSeek 返回内容为空");
  }

  return normalizeDeepSeekReport(parseJsonContent(content), fallback, model);
}
