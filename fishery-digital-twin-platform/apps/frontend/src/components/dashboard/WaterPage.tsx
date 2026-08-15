"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Play } from "lucide-react";
import type { AIReport, PlatformSnapshot } from "@fishery/shared";
import { generateAiReport, generateDemoSimulation, getAiReport, getAiStatus } from "@/lib/api";
import { usePlatformData } from "@/hooks/usePlatformData";
import { ActionButton, EmptyPanel, InfoPanel, PageFrame, PageHeader, StatusBadge, TextList, useVisualReady } from "@/components/dashboard/DashboardPrimitives";
import { NavigationCameraPanel } from "@/components/dashboard/NavigationCameraPanel";
import { InsightIcon } from "@/components/icons/MaritimeIcons";

const riskLabel: Record<AIReport["riskLevel"], string> = {
  normal: "状态正常",
  attention: "需要关注",
  warning: "风险预警",
};

const waterRangeOptions = [
  { label: "1 小时", value: "1h", limit: 60 },
  { label: "6 小时", value: "6h", limit: 360 },
  { label: "24 小时", value: "24h", limit: 1440 },
  { label: "7 天", value: "7d", limit: 10080 },
] as const;

const waterUnitMap: Record<string, string> = {
  水温: "°C",
  浊度: "NTU",
  pH: "",
  溶解氧: "mg/L",
  氨氮: "mg/L",
  电导率: "μS/cm",
};

type WaterRange = (typeof waterRangeOptions)[number]["value"];
type WaterChartDatum = Record<string, string | number>;
type WaterChartLine = {
  dataKey: string;
  stroke: string;
  yAxisId?: "left" | "right";
};



export function WaterPage() {
  const { snapshot } = usePlatformData();
  const visualReady = useVisualReady();
  const [selectedRange, setSelectedRange] = useState<WaterRange>("1h");
  const [collectedWater, setCollectedWater] = useState<PlatformSnapshot["water"]>([]);
  const [collectionRunning, setCollectionRunning] = useState(false);
  const [collectionTotal, setCollectionTotal] = useState(0);
  const [viewMode, setViewMode] = useState<"live" | "demo">("live");
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const collectionTimerRef = useRef<number | null>(null);
  const latest = collectedWater.at(-1) ?? snapshot.water.at(-1);
  const selectedLimit = waterRangeOptions.find((option) => option.value === selectedRange)?.limit ?? 60;
  const visibleWater = useMemo(() => collectedWater.slice(-selectedLimit), [collectedWater, selectedLimit]);
  const chartData = useMemo(() => visibleWater.map((item) => ({
    time: new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    水温: item.waterTemperature,
    浊度: item.turbidity,
    pH: item.ph,
    溶解氧: item.dissolvedOxygen ?? 6.8,
    氨氮: item.ammoniaNitrogen ?? 0.08,
    电导率: item.conductivity ?? 460,
  })), [visibleWater]);

  useEffect(() => () => {
    if (collectionTimerRef.current !== null) {
      window.clearInterval(collectionTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (viewMode === "live" && !collectionRunning) {
      setCollectedWater(snapshot.water);
      setCollectionTotal(snapshot.water.length);
    }
  }, [collectionRunning, snapshot.water, viewMode]);

  function clearCollectionTimer() {
    if (collectionTimerRef.current !== null) {
      window.clearInterval(collectionTimerRef.current);
      collectionTimerRef.current = null;
    }
  }

  function animateCollection(source: PlatformSnapshot["water"]) {
    clearCollectionTimer();
    setCollectedWater([]);
    setCollectionTotal(source.length);
    setCollectionRunning(true);

    return new Promise<number>((resolve) => {
      let cursor = 0;
      collectionTimerRef.current = window.setInterval(() => {
        cursor += 1;
        setCollectedWater(source.slice(0, cursor));

        if (cursor >= source.length) {
          clearCollectionTimer();
          setCollectionRunning(false);
          resolve(source.length);
        }
      }, 90);
    });
  }

  async function startWaterCollection() {
    clearCollectionTimer();
    setCollectionError(null);
    setViewMode("demo");
    setCollectedWater([]);
    setCollectionTotal(96);
    setCollectionRunning(true);

    const result = await generateDemoSimulation(96);
    const source = result.snapshot.water.slice(-result.count);

    if (source.length === 0) {
      setCollectionRunning(false);
      setCollectionTotal(0);
      throw new Error("no water data available");
    }

    return animateCollection(source);
  }

  function handleHeaderCollection() {
    startWaterCollection().catch(() => {
      setCollectionRunning(false);
      setCollectionTotal(0);
      setCollectionError("演示数据生成失败，请检查后端连接");
      setViewMode("live");
    });
  }

  function returnToLiveData() {
    clearCollectionTimer();
    setCollectionRunning(false);
    setCollectionError(null);
    setViewMode("live");
    setCollectedWater(snapshot.water);
    setCollectionTotal(snapshot.water.length);
  }

  return (
    <PageFrame wide>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <PageHeader kicker="Water Intelligence" title="水域环境监测" description="水质数据、历史趋势、数据采集和智能分析报告集中在同一模块。" />
        <div className="flex flex-wrap gap-3">
          {viewMode === "demo" ? <ActionButton icon={Play} label="返回实时数据" onClick={returnToLiveData} /> : null}
          <ActionButton
            icon={Play}
            label={collectionRunning ? "演示生成中" : "生成演示数据"}
            onClick={handleHeaderCollection}
            disabled={collectionRunning}
            primary
          />
        </div>
      </div>

      <NavigationCameraPanel cameraPurpose="water-observation" />

      {collectionError ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{collectionError}</p> : null}

      <WaterOverviewPanel latest={latest} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.58fr)_minmax(320px,.72fr)]">
        <div>
          <CoreWaterTrendChart
            chartData={chartData}
            visualReady={visualReady}
            actions={(
              <div className="flex w-fit rounded-2xl border border-app-line bg-white/80 p-1">
                {waterRangeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setSelectedRange(option.value)}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                      selectedRange === option.value
                        ? "bg-harbor-600 text-white shadow-sm"
                        : "text-ink-500 hover:text-ink-900"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          />
          <div className="mt-3 flex items-center justify-between text-xs font-semibold text-ink-500">
            <span>{collectionRunning ? `演示生成中 ${visibleWater.length} / ${collectionTotal}` : visibleWater.length > 0 ? `当前显示 ${visibleWater.length} 个采样点` : "等待数据"}</span>
            <span>{viewMode === "demo" ? "独立演示数据，不写入实时历史" : "实时历史数据"}</span>
          </div>
          {collectionTotal > 0 ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-app-subtle">
              <div
                className="h-full rounded-full bg-harbor-500 transition-all duration-150"
                style={{ width: `${Math.min(100, (visibleWater.length / collectionTotal) * 100)}%` }}
              />
            </div>
          ) : null}
        </div>

        <WaterAnalysisSection
          snapshot={snapshot}
          visualReady={visualReady}
          waterForAnalysis={collectedWater}
          collecting={collectionRunning}
          demoMode={viewMode === "demo"}
          compact
        />
      </div>
    </PageFrame>
  );
}

function WaterOverviewPanel({ latest }: { latest: PlatformSnapshot["water"][number] | undefined }) {
  const sourceLabel = latest?.source === "sensor" ? "真实传感器" : latest?.source === "demo" ? "演示数据" : "离线占位";
  const sourceTone = latest?.source === "sensor" ? "bg-sage-100 text-sage-500" : "bg-sand-100 text-sand-500";
  const overallLabel = !latest
    ? "等待数据"
    : latest.status === "normal"
      ? "良好"
      : latest.status === "attention"
        ? "需关注"
        : "预警";
  const updatedAt = latest
    ? new Date(latest.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "--:--:--";
  const sensors = [
    { label: "水温", value: latest ? `${latest.waterTemperature.toFixed(1)} °C` : "--", status: latest && latest.waterTemperature >= 22 && latest.waterTemperature <= 30 ? "正常" : "关注" },
    { label: "pH", value: latest ? latest.ph.toFixed(2) : "--", status: latest && latest.ph >= 6.8 && latest.ph <= 8.4 ? "正常" : "关注" },
    { label: "浊度", value: latest ? `${latest.turbidity.toFixed(1)} NTU` : "--", status: latest && latest.turbidity <= 34 ? "良好" : "关注" },
    { label: "溶解氧", value: latest?.dissolvedOxygen != null ? `${latest.dissolvedOxygen.toFixed(1)} mg/L` : "--", status: latest?.dissolvedOxygen == null ? "未连接" : latest.dissolvedOxygen >= 5.5 ? "正常" : "关注" },
    { label: "氨氮", value: latest?.ammoniaNitrogen != null ? `${latest.ammoniaNitrogen.toFixed(2)} mg/L` : "--", status: latest?.ammoniaNitrogen == null ? "未连接" : latest.ammoniaNitrogen <= 0.2 ? "正常" : "关注" },
    { label: "电导率", value: latest?.conductivity != null ? `${latest.conductivity.toFixed(0)} μS/cm` : "--", status: latest?.conductivity == null ? "未连接" : latest.conductivity >= 200 && latest.conductivity <= 800 ? "正常" : "关注" },
  ];

  return (
    <section className="overflow-hidden rounded-[26px] border border-app-line bg-white shadow-soft">
      <div className="flex flex-col gap-3 border-b border-app-line bg-[linear-gradient(110deg,#f7fbfb_0%,#eaf6f4_100%)] px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-ink-900">水质数据总览</h2>
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${sourceTone}`}>
              <span className="h-2 w-2 rounded-full bg-current" />{sourceLabel}
            </span>
          </div>
          <p className="mt-2 text-xs font-semibold text-ink-500">最近更新：{updatedAt}</p>
        </div>
        <span className="text-xs font-semibold text-harbor-600">环境传感器组 · 6 项指标</span>
      </div>
      <div className="grid lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="grid place-items-center border-b border-app-line bg-harbor-50/70 px-8 py-9 text-center lg:border-b-0 lg:border-r">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-ink-500">综合水质状态</p>
            <strong className={`mt-4 block text-5xl font-semibold ${overallLabel === "良好" ? "text-sage-500" : overallLabel === "等待数据" ? "text-ink-500" : "text-sand-500"}`}>{overallLabel}</strong>
            <p className="mt-4 text-sm text-ink-500">基于当前所示数据综合判断</p>
          </div>
        </div>
        <div className="grid divide-y divide-app-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="divide-y divide-app-line">
            {sensors.slice(0, 3).map((sensor) => <WaterSensorRow key={sensor.label} {...sensor} />)}
          </div>
          <div className="divide-y divide-app-line">
            {sensors.slice(3).map((sensor) => <WaterSensorRow key={sensor.label} {...sensor} />)}
          </div>
        </div>
      </div>
    </section>
  );
}

function WaterSensorRow({ label, value, status }: { label: string; value: string; status: string }) {
  const inactive = status === "未连接";
  const attention = status === "关注";
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-5 text-sm">
      <span className="font-semibold text-ink-500">{label}</span>
      <strong className="text-ink-900">{value}</strong>
      <span className={`text-xs font-semibold ${inactive ? "text-ink-500" : attention ? "text-sand-500" : "text-sage-500"}`}>{status}</span>
    </div>
  );
}

function CoreWaterTrendChart({ chartData, visualReady, actions }: { chartData: WaterChartDatum[]; visualReady: boolean; actions?: React.ReactNode }) {
  const lines: WaterChartLine[] = [
    { dataKey: "水温", stroke: "#0f7f8a", yAxisId: "left" },
    { dataKey: "溶解氧", stroke: "#2563eb", yAxisId: "left" },
    { dataKey: "pH", stroke: "#a56b2f", yAxisId: "right" },
  ];
  const lowOxygenAreaProps = {
    yAxisId: "left",
    y1: 0,
    y2: 5,
    fill: "#fee2e2",
    fillOpacity: 0.34,
  } as React.ComponentProps<typeof ReferenceArea>;

  return (
    <div className="min-h-[440px] rounded-3xl border border-harbor-600/10 bg-gradient-to-br from-harbor-100/80 via-white to-sage-100/70 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-900">水温 / 溶解氧 / pH</h3>
          <p className="mt-1 text-xs font-semibold text-ink-500">左轴：水温与溶解氧，右轴：pH</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <ChartLegend lines={lines} />
          {actions}
        </div>
      </div>
      <div className="h-[380px]">
        {!visualReady ? (
          <EmptyPanel text="图表初始化中" />
        ) : chartData.length === 0 ? (
          <EmptyPanel text="点击数据采集开始绘制曲线" />
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={260} minHeight={280}>
            <LineChart data={chartData} margin={{ top: 12, right: 10, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="#dfe6ee" vertical={false} />
              <XAxis dataKey="time" stroke="#667085" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" stroke="#667085" fontSize={11} tickLine={false} axisLine={false} domain={[0, 34]} />
              <YAxis yAxisId="right" orientation="right" stroke="#667085" fontSize={11} tickLine={false} axisLine={false} domain={[6.8, 8.8]} />
              <ReferenceArea {...lowOxygenAreaProps} />
              <Tooltip content={<WaterTooltip />} />
              {lines.map((line) => (
                <Line
                  key={line.dataKey}
                  type="monotone"
                  dataKey={line.dataKey}
                  yAxisId={line.yAxisId}
                  stroke={line.stroke}
                  strokeWidth={2.7}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function ChartLegend({ lines }: { lines: WaterChartLine[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {lines.map((line) => (
        <span key={line.dataKey} className="inline-flex items-center gap-2 text-xs font-semibold text-ink-500">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: line.stroke }} />
          {line.dataKey}
        </span>
      ))}
    </div>
  );
}

function WaterTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: string | number; color?: string; stroke?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-2xl border border-app-line bg-white px-4 py-3 text-xs shadow-soft">
      <p className="mb-2 font-semibold text-ink-900">{label}</p>
      <div className="space-y-2">
        {payload.map((entry) => {
          const key = String(entry.dataKey ?? "");
          const unit = waterUnitMap[key] ? ` ${waterUnitMap[key]}` : "";
          const value = typeof entry.value === "number" ? Number(entry.value.toFixed(key === "pH" ? 2 : key === "氨氮" ? 2 : 1)) : entry.value;
          return (
            <div key={key} className="flex min-w-[150px] items-center justify-between gap-5">
              <span className="inline-flex items-center gap-2 text-ink-500">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color || entry.stroke }} />
                {key}
              </span>
              <strong className="font-semibold text-ink-900">{value}{unit}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AiPage() {
  const { snapshot } = usePlatformData();
  const visualReady = useVisualReady();
  return (
    <PageFrame>
      <PageHeader kicker="AI Decision" title="环境监测" description="分析报告已集成到环境监测模块。" />
      <WaterAnalysisSection snapshot={snapshot} visualReady={visualReady} />
    </PageFrame>
  );
}

function WaterAnalysisSection({
  snapshot,
  visualReady,
  waterForAnalysis = snapshot.water,
  collecting = false,
  demoMode = false,
  compact = false,
}: {
  snapshot: ReturnType<typeof usePlatformData>["snapshot"];
  visualReady: boolean;
  waterForAnalysis?: PlatformSnapshot["water"];
  collecting?: boolean;
  demoMode?: boolean;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<{ configured: boolean; model: string; hasReport: boolean } | null>(null);
  const [report, setReport] = useState<AIReport | null>(null);
  const [message, setMessage] = useState("尚未生成预测报告");
  const [busy, setBusy] = useState(false);
  const visibleReport = demoMode ? null : report;
  const currentWater = waterForAnalysis.at(-1) ?? snapshot.water.at(-1);
  const localIssues = [
    currentWater && currentWater.dissolvedOxygen != null && currentWater.dissolvedOxygen < 5.5 ? "溶解氧偏低" : null,
    currentWater && currentWater.ammoniaNitrogen != null && currentWater.ammoniaNitrogen > 0.2 ? "氨氮偏高" : null,
    currentWater && (currentWater.ph < 6.8 || currentWater.ph > 8.4) ? "pH 超出参考区间" : null,
    currentWater && currentWater.turbidity > 34 ? "浊度偏高" : null,
  ].filter((item): item is string => Boolean(item));
  const modelingChartData = useMemo(() => waterForAnalysis.slice(-48).map((item) => ({
    time: new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
    水温: item.waterTemperature,
    浊度: item.turbidity,
    pH: item.ph,
  })), [waterForAnalysis]);

  useEffect(() => {
    getAiStatus().then(setStatus).catch(() => setStatus(null));
    getAiReport().then((next) => {
      setReport(next);
      setMessage(`已分析 ${next.sampleCount} 个采样点`);
    }).catch(() => undefined);
  }, []);

  async function handleGenerate() {
    if (demoMode) {
      setMessage("演示数据不写入实时分析，请先返回实时数据");
      return;
    }
    setBusy(true);
    setMessage("正在生成智能预测报告");
    try {
      const result = await generateAiReport();
      setReport(result.report);
      setMessage(`已分析 ${result.report.sampleCount} 个采样点`);
    } catch (error) {
      setMessage(error instanceof Error ? "智能报告生成失败，请检查后端和密钥配置" : "智能报告生成失败");
    } finally {
      setBusy(false);
    }
  }

  if (compact) {
    const localJudgement = !currentWater
      ? "等待采样数据"
      : localIssues.length > 0
        ? "水质需要关注"
        : "水质整体良好";

    return (
      <aside className="flex min-h-[440px] flex-col rounded-[26px] border border-app-line bg-[linear-gradient(160deg,#ffffff_0%,#eff8f6_100%)] p-6 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-harbor-600">WATER INSIGHT</p>
            <h2 className="mt-2 text-xl font-semibold text-ink-900">水质分析</h2>
          </div>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-harbor-100 text-harbor-600">
            <InsightIcon className="h-5 w-5" />
          </span>
        </div>

        <div className="mt-8">
          <p className="text-xs font-semibold text-ink-500">当前判断</p>
          <strong className={`mt-3 block text-2xl font-semibold ${localIssues.length > 0 ? "text-sand-500" : "text-sage-500"}`}>
            {visibleReport?.title || localJudgement}
          </strong>
          <p className="mt-3 text-sm leading-6 text-ink-500">
            {visibleReport?.summary || (currentWater ? "当前关键指标处于可监测范围，建议持续观察趋势变化。" : "接收到实时样本后，将生成水质判断。")}
          </p>
        </div>

        <div className="mt-7 border-t border-app-line pt-6">
          <p className="text-xs font-semibold text-ink-500">异常提醒</p>
          {localIssues.length > 0 ? (
            <ul className="mt-3 space-y-2 text-sm text-sand-500">
              {localIssues.map((issue) => <li key={issue}>• {issue}</li>)}
            </ul>
          ) : (
            <p className="mt-3 text-sm font-semibold text-sage-500">暂无异常</p>
          )}
        </div>

        <div className="mt-auto pt-8">
          <div className="mb-4 flex flex-wrap gap-2">
            <StatusBadge text={status?.configured ? "大模型已配置" : "本地预测"} tone={status?.configured ? "good" : "neutral"} />
            <StatusBadge text={demoMode ? "演示模式：AI 分析已隔离" : message} tone={visibleReport ? "good" : "neutral"} />
          </div>
          <ActionButton icon={InsightIcon} label={busy ? "分析中" : "生成预测报告"} onClick={handleGenerate} disabled={busy || collecting || demoMode} primary />
        </div>
      </aside>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <StatusBadge text={status?.configured ? "大模型已配置" : "未配置大模型，使用本地预测"} tone={status?.configured ? "good" : "neutral"} />
          <StatusBadge text={message} tone={report ? "good" : "neutral"} />
        </div>
        <div className="flex flex-wrap gap-3">
          <ActionButton icon={InsightIcon} label="生成预测报告" onClick={handleGenerate} disabled={busy || collecting} primary />
        </div>
      </div>

      <ModelingVisualizationPanel chartData={modelingChartData} visualReady={visualReady} />

      {report ? (
        <ReportView report={report} />
      ) : (
        <section className="rounded-3xl border border-dashed border-app-line bg-white p-10 text-center shadow-soft">
          <p className="text-sm font-semibold text-ink-700">尚未生成分析报告</p>
          <p className="mt-3 text-sm text-ink-500">点击“生成预测报告”后，这里会显示风险等级、关键发现、行动建议和数据质量说明。</p>
        </section>
      )}
    </>
  );
}



function ModelingVisualizationPanel({
  chartData,
  visualReady,
}: {
  chartData: Array<{ time: string; 水温: number; 浊度: number; pH: number }>;
  visualReady: boolean;
}) {
  return (
    <section className="rounded-3xl border border-app-line bg-white p-6 shadow-soft">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-ink-900">数学建模中的数据可视化应用</h2>
        </div>
      </div>

      <div className="mt-6 h-[320px] rounded-2xl bg-app-subtle p-4">
        {!visualReady ? (
          <EmptyPanel text="建模图表初始化中" />
        ) : chartData.length === 0 ? (
          <EmptyPanel text="等待数据采集" />
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={260} minHeight={220}>
            <LineChart data={chartData} margin={{ top: 8, right: 18, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="#dfe6ee" vertical={false} />
              <XAxis dataKey="time" stroke="#667085" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#667085" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: "#fff", border: "1px solid #dfe6ee", borderRadius: 14, boxShadow: "0 18px 50px rgba(23,32,51,.08)" }} />
              <Line type="monotone" dataKey="水温" stroke="#0f7f8a" strokeWidth={2.3} dot={false} />
              <Line type="monotone" dataKey="浊度" stroke="#5f8f72" strokeWidth={2.3} dot={false} />
              <Line type="monotone" dataKey="pH" stroke="#a56b2f" strokeWidth={2.3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function ReportView({ report, muted = false }: { report: AIReport; muted?: boolean }) {
  return (
    <section className={`rounded-3xl border border-app-line bg-white p-7 shadow-soft ${muted ? "opacity-70" : ""}`}>
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div>
          <StatusBadge text={riskLabel[report.riskLevel]} tone={report.riskLevel === "normal" ? "good" : report.riskLevel === "warning" ? "warn" : "neutral"} />
          <h2 className="mt-5 text-2xl font-semibold tracking-normal">{report.title}</h2>
          <p className="mt-5 max-w-4xl text-base leading-8 text-ink-500">{report.summary}</p>
        </div>
        <div className="rounded-2xl bg-app-subtle px-5 py-4 text-sm text-ink-500">
          <p>智能分析模型</p>
          <p className="mt-2">{new Date(report.generatedAt).toLocaleString("zh-CN", { hour12: false })}</p>
          <p className="mt-2">置信度 {Math.round(report.confidence * 100)}%</p>
        </div>
      </div>

      <div className="mt-9 grid gap-8 lg:grid-cols-2">
        <TextList title="关键发现" items={report.findings} />
        <TextList title="行动建议" items={report.recommendations} />
      </div>

      <div className="mt-9 grid gap-5 md:grid-cols-4">
        <InfoPanel label="预测周期" value={`${report.forecast.horizonHours} 小时`} />
        <InfoPanel label="藻华风险" value={report.forecast.algaeRisk === "low" ? "低" : report.forecast.algaeRisk === "medium" ? "中" : "高"} />
        <InfoPanel label="浊度趋势" value={report.forecast.turbidityTrend === "rising" ? "上升" : report.forecast.turbidityTrend === "falling" ? "下降" : "稳定"} />
        <InfoPanel label="续航估计" value={report.forecast.batteryRuntimeHours > 0 ? `${report.forecast.batteryRuntimeHours.toFixed(1)} 小时` : "未估算"} />
      </div>

      <p className="mt-8 rounded-2xl bg-app-subtle p-5 text-sm leading-7 text-ink-500">{report.dataQuality}</p>
    </section>
  );
}
