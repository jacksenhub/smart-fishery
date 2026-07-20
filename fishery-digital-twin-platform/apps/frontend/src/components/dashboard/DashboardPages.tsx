"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, ArrowDown, ArrowUp, Battery, Bot, CheckCircle2, CircleStop, Clock3, Compass, Cpu, Database, FileText, Flag, FlaskConical, Gauge, LoaderCircle, MapPin, Maximize2, Navigation, Play, RotateCcw, Route, Ship, ShieldAlert, SlidersHorizontal, Thermometer, Waves, Wrench } from "lucide-react";
import type { AIReport, DeviceStatus, PlatformSnapshot, PropulsionDevice, PropulsionSnapshot, ServoDevice, ServoSnapshot, SystemLog, TwinFaultType, TwinRiskLevel, TwinSimulationInput, TwinSimulationResult, TwinWaveLevel, WaterStatus } from "@fishery/shared";
import { generateAiReport, generateSimulation, getAiReport, getAiStatus, getPropulsionSnapshot, getServoSnapshot, getSystemLogs, runTwinPrediction, setPropulsionTarget, setServoAngles, setServoChannel } from "@/lib/api";
import { usePlatformData } from "@/hooks/usePlatformData";
import { useDeviceFeedback } from "@/hooks/useDeviceFeedback";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { StatusPill } from "@/components/ui/StatusPill";

const BoatTwinScene = dynamic(() => import("@/components/three/BoatTwinScene").then((module) => module.BoatTwinScene), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-ink-500">模型加载中</div>,
});

const NavigationMap = dynamic(() => import("@/components/map/NavigationMap").then((module) => module.NavigationMap), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-ink-500">地图加载中</div>,
});

const waterStatusLabel: Record<WaterStatus, string> = {
  normal: "正常",
  attention: "轻度关注",
  polluted: "严重污染",
  "algae-risk": "藻华风险",
};

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

type TwinViewMode = "follow" | "top" | "front";
type TwinSimulationMode = "route" | "fault" | "fatigue";

const DC_MOTOR_DEVICE_ID = "maker-esp32-pro-dc-01";
const DC_MOTOR_MAX_POWER = 35;

export function TwinPage() {
  const { snapshot } = usePlatformData(8000);
  const {
    servos: deviceServos,
    propulsion: devicePropulsion,
    connected: feedbackConnected,
  } = useDeviceFeedback(1000);
  const latest = snapshot.water.at(-1);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<TwinViewMode>("follow");
  const [liveOcean, setLiveOcean] = useState(true);
  const [simulationMode, setSimulationMode] = useState<TwinSimulationMode>("route");
  const [simulationInput, setSimulationInput] = useState<TwinSimulationInput>({
    routeDistanceKm: Math.max(0.2, Number(snapshot.navigation.remainingDistance.toFixed(1))),
    targetSpeedMps: Math.max(0.4, Number(snapshot.navigation.speed.toFixed(1))),
    waveLevel: "moderate",
    faultType: "motor-derate",
    faultSeverity: 45,
    operatingHours: 800,
    dailyServoCycles: 480,
  });
  const [simulationResult, setSimulationResult] = useState<TwinSimulationResult | null>(null);
  const [simulationRunning, setSimulationRunning] = useState(false);
  const [simulationError, setSimulationError] = useState("");
  const servoDevices = ["servo-quad-01", "servo-quad-02"].map((deviceId) =>
    deviceServos?.devices.find((device) => device.device_id === deviceId),
  );
  const motorDevice = devicePropulsion?.devices.find((device) => device.device_id === DC_MOTOR_DEVICE_ID);
  const servoActualAngles = servoDevices.flatMap((device) => device?.actual_angles ?? [null, null, null, null]);
  const servoBoardOnline = servoDevices.map((device) => Boolean(device?.online));
  const feedbackOnline = servoBoardOnline.some(Boolean) || Boolean(motorDevice?.online);
  const feedbackTimes = [
    ...servoDevices.map((device) => device?.last_seen),
    motorDevice?.last_seen,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  const latestFeedbackAt = feedbackTimes.length > 0 ? new Date(Math.max(...feedbackTimes)) : null;
  const baseMissionProgress = Math.min(96, Math.max(18, Math.round((1 - snapshot.navigation.remainingDistance / 4) * 100)));
  const missionProgress = Math.min(100, Math.max(0, baseMissionProgress));
  const averageBattery = Math.round(snapshot.batteries.reduce((sum, item) => sum + item.percentage, 0) / snapshot.batteries.length);
  const runtimeHours = Math.max(0.5, averageBattery / 18).toFixed(1);
  const navigationTrend = useMemo(() => Array.from({ length: 20 }, (_, index) => ({
    point: index + 1,
    speed: Number(Math.max(0, snapshot.navigation.speed + Math.sin(index * 0.52) * 0.13 + ((index % 4) - 1.5) * 0.018).toFixed(2)),
    battery: Number(Math.max(0, averageBattery - (19 - index) * 0.11).toFixed(1)),
  })), [averageBattery, snapshot.navigation.speed]);
  const syncTime = latestFeedbackAt
    ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(latestFeedbackAt)
    : "--:--:--";

  const feedbackSignature = `${servoActualAngles.join(",")}|${servoBoardOnline.join(",")}|${motorDevice?.actual_left_power ?? 0}|${motorDevice?.online ? 1 : 0}`;
  const deviceFeedback = useMemo(
    () => ({
      servoAngles: servoActualAngles,
      servoBoardOnline,
      motorPower: motorDevice?.actual_left_power ?? 0,
      motorOnline: Boolean(motorDevice?.online),
    }),
    // Only rebuild (and trigger a 3D re-render) when the actual feedback values change.
    [feedbackSignature],
  );

  function resetSceneView() {
    setViewMode("follow");
  }

  function requestSceneFullscreen() {
    sceneRef.current?.requestFullscreen?.();
  }

  function updateSimulationInput<K extends keyof TwinSimulationInput>(key: K, value: TwinSimulationInput[K]) {
    setSimulationInput((current) => ({ ...current, [key]: value }));
  }

  async function runSimulation() {
    setSimulationRunning(true);
    setSimulationError("");
    try {
      const result = await runTwinPrediction(simulationInput);
      setSimulationResult(result);
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : "仿真服务暂时不可用");
    } finally {
      setSimulationRunning(false);
    }
  }

  return (
    <PageFrame wide>
      <section className="flex flex-col gap-5 rounded-[24px] border border-mist-200 bg-white/90 px-5 py-4 shadow-[0_18px_55px_rgba(42,85,102,0.07)] xl:flex-row xl:items-center xl:justify-between">
        <h1 className="text-2xl font-semibold tracking-normal text-ink-900 md:text-3xl">数字孪生中心</h1>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-3 sm:divide-x sm:divide-mist-200">
          <TwinHeaderStatus
            icon={CheckCircle2}
            label="设备反馈"
            value={!feedbackConnected ? "后端不可达" : feedbackOnline ? "在线" : "等待设备"}
            tone={!feedbackConnected ? "danger" : feedbackOnline ? "good" : "neutral"}
          />
          <TwinHeaderStatus icon={Clock3} label="最近反馈" value={syncTime} />
          <TwinHeaderStatus icon={Thermometer} label="最新水温" value={latest ? `${latest.waterTemperature.toFixed(1)}°C` : "--"} />
        </div>
      </section>

      <div className="space-y-7">
        <section ref={sceneRef} className="overflow-hidden rounded-[26px] border border-mist-200 bg-white shadow-[0_24px_70px_rgba(50,91,109,0.09)]">
          <div className="relative h-[560px] bg-[linear-gradient(180deg,#edfaff_0%,#dff3f8_55%,#d5eef4_100%)] md:h-[660px] xl:h-[720px]">
            <BoatTwinScene
              viewMode={viewMode}
              autoRotate={false}
              float={false}
              showOcean
              liveOcean={liveOcean}
              showGrid={false}
              deviceFeedback={deviceFeedback}
              simulationPreview={simulationResult && simulationMode === "route" ? { active: true, risk: simulationResult.route.risk } : undefined}
            />

            <div className="absolute left-5 top-5 max-w-[calc(100%-2.5rem)] rounded-2xl border border-white/85 bg-white/86 px-4 py-3 text-xs font-semibold text-ink-500 shadow-[0_12px_35px_rgba(42,91,109,0.11)] backdrop-blur-md">
              <div className="flex items-center gap-2 text-ink-900">
                <span className={`h-2.5 w-2.5 rounded-full ${feedbackOnline ? "bg-emerald-500" : "bg-slate-400"}`} />
                动画来源：ESP32 实际反馈
              </div>
              <p className="mt-2">舵机板 {servoBoardOnline.filter(Boolean).length}/2 在线 · M0 {motorDevice?.online ? "在线" : "离线"}</p>
            </div>

            <div className="absolute right-5 top-5 hidden rounded-2xl border border-white/80 bg-white/82 px-4 py-3 text-[11px] font-semibold text-ink-500 shadow-[0_12px_35px_rgba(42,91,109,0.1)] backdrop-blur-md sm:block">
              <p className="mb-2 text-ink-900">图例</p>
              <ul className="space-y-1.5">
                <li className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-[#06b6d4]" />舵机 / 执行机构 在线</li>
                <li className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-slate-400" />离线 / 无反馈</li>
                <li className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-emerald-500" />电机正转</li>
                <li className="flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-amber-500" />电机反转</li>
              </ul>
            </div>

            {simulationResult && simulationMode === "route" ? (
              <div className="absolute left-5 top-28 max-w-[calc(100%-2.5rem)] rounded-xl border border-amber-200 bg-amber-50/92 px-3 py-2 text-[11px] font-semibold text-amber-800 shadow-[0_10px_28px_rgba(120,83,24,0.1)] backdrop-blur-md">
                <span className="inline-flex items-center gap-2"><FlaskConical className="h-3.5 w-3.5" />仿真预测图层</span>
                <span className="ml-2 text-amber-700">不代表设备实际位置</span>
              </div>
            ) : null}

            <div className="pointer-events-none absolute bottom-5 left-1/2 hidden -translate-x-1/2 rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-ink-500 shadow-[0_10px_30px_rgba(42,91,109,0.1)] backdrop-blur-md lg:block">
              拖拽旋转 · 滚轮缩放 · 右键平移
            </div>

            <div className="absolute bottom-5 left-5 rounded-2xl border border-white/80 bg-white/82 px-4 py-3 text-xs font-semibold text-ink-500 shadow-[0_12px_35px_rgba(42,91,109,0.11)] backdrop-blur-md">
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-harbor-600" />
                {snapshot.navigation.position.lat.toFixed(5)}, {snapshot.navigation.position.lng.toFixed(5)}
              </div>
              <div className="mt-2 h-1 w-24 rounded-full bg-harbor-100">
                <div className="h-full w-14 rounded-full bg-harbor-500" />
              </div>
            </div>

            <div className="absolute bottom-5 right-5 flex gap-2">
              <button type="button" onClick={resetSceneView} className="grid h-10 w-10 place-items-center rounded-xl border border-white/80 bg-white/82 text-ink-700 shadow-[0_10px_30px_rgba(42,91,109,0.1)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:text-harbor-600 active:translate-y-0 active:scale-95" title="视角复位">
                <RotateCcw className="h-4 w-4" />
              </button>
              <button type="button" onClick={requestSceneFullscreen} className="grid h-10 w-10 place-items-center rounded-xl border border-white/80 bg-white/82 text-ink-700 shadow-[0_10px_30px_rgba(42,91,109,0.1)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:text-harbor-600 active:translate-y-0 active:scale-95" title="全屏查看">
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="border-t border-mist-200 bg-mist-50 p-4">
            <TwinFeedbackBar
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onResetView={resetSceneView}
              connected={feedbackConnected}
              online={feedbackOnline}
              feedbackTime={syncTime}
              liveOcean={liveOcean}
              onToggleLiveOcean={() => setLiveOcean((value) => !value)}
            />
          </div>
        </section>

        <TwinDeviceFeedbackPanel
          servoDevices={servoDevices}
          motorDevice={motorDevice}
          connected={feedbackConnected}
        />

        <TwinPredictionWorkbench
          mode={simulationMode}
          input={simulationInput}
          result={simulationResult}
          running={simulationRunning}
          error={simulationError}
          onModeChange={setSimulationMode}
          onInputChange={updateSimulationInput}
          onRun={runSimulation}
        />

        <div className="grid gap-6 xl:grid-cols-[0.78fr_1.42fr]">
          <section className="rounded-[24px] border border-mist-200 bg-mist-50 p-6 shadow-[0_18px_52px_rgba(45,84,101,0.065)]">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-ink-900">任务概览</h2>
              <StatusPill status={feedbackOnline ? "online" : "offline"} />
            </div>
            <div className="mt-6 space-y-4">
              <TwinKeyValue label="当前任务" value={snapshot.vessel.mission || "未下发任务"} />
              <TwinKeyValue label="运行状态" value={feedbackOnline ? "设备反馈在线" : feedbackConnected ? "等待设备反馈" : "后端不可达"} />
              <TwinKeyValue label="目标航点" value={snapshot.navigation.targetWaypoint.label || "未设置"} />
            </div>
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-ink-500">
                <span>任务进度</span>
                <span>{missionProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-app-subtle">
                <div className="h-full rounded-full bg-harbor-500" style={{ width: `${missionProgress}%` }} />
              </div>
            </div>
          </section>

          <section className="rounded-[24px] border border-mist-200 bg-white p-6 shadow-[0_18px_52px_rgba(45,84,101,0.065)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <h2 className="text-lg font-semibold text-ink-900">航行核心参数</h2>
              <div className="flex items-center gap-5 text-xs font-semibold text-ink-500">
                <span>航向 <strong className="ml-1 text-ink-900">{snapshot.navigation.heading}°</strong></span>
                <span>续航 <strong className="ml-1 text-ink-900">{runtimeHours} h</strong></span>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <TwinMiniTrend
                data={navigationTrend}
                dataKey="speed"
                label="实时航速"
                value={snapshot.navigation.speed.toFixed(2)}
                unit="m/s"
                color="#168997"
                gradientId="twin-speed-fill"
              />
              <TwinMiniTrend
                data={navigationTrend}
                dataKey="battery"
                label="剩余电量"
                value={`${averageBattery}`}
                unit="%"
                color="#5f8f72"
                gradientId="twin-battery-fill"
              />
            </div>
          </section>
        </div>

        <section className="rounded-[24px] border border-mist-200 bg-mist-50 p-6 shadow-[0_18px_52px_rgba(45,84,101,0.06)]">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-ink-900">环境采样数据</h2>
            <span className="text-xs font-semibold text-harbor-600">平台数据快照</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <TwinMetricItem icon={Thermometer} label="水温" value={latest ? latest.waterTemperature.toFixed(1) : "--"} unit="°C" />
            <TwinMetricItem icon={Waves} label="浊度" value={latest ? latest.turbidity.toFixed(1) : "--"} unit="NTU" />
            <TwinMetricItem icon={CheckCircle2} label="pH" value={latest ? latest.ph.toFixed(2) : "--"} unit="" />
            <TwinMetricItem icon={Flag} label="当前航点" value={snapshot.navigation.targetWaypoint.label || "--"} unit="" />
          </div>
        </section>
      </div>
    </PageFrame>
  );
}

function LegacyTwinPage() {
  const { snapshot } = usePlatformData();
  return (
    <PageFrame wide>
      <PageHeader kicker="Digital Twin" title="数字孪生中心" description="船体模型独立展示，运行状态放在右侧，不再压缩到总控页里。" />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-h-[480px] overflow-hidden rounded-[28px] bg-white shadow-soft md:min-h-[620px]">
          <BoatTwinScene />
        </div>
        <div className="space-y-4">
          <InfoPanel label="当前运行状态" value={snapshot.vessel.online ? "在线巡检" : "离线"} />
          <InfoPanel label="当前任务" value={snapshot.vessel.mission} />
          <InfoPanel label="航速" value={`${snapshot.navigation.speed.toFixed(2)} m/s`} />
          <InfoPanel label="航向" value={`${snapshot.navigation.heading}°`} />
          <InfoPanel label="目标航点" value={snapshot.navigation.targetWaypoint.label || "目标航点"} />
        </div>
      </div>
    </PageFrame>
  );
}

export function WaterPage() {
  const { snapshot } = usePlatformData();
  const visualReady = useVisualReady();
  const [selectedRange, setSelectedRange] = useState<WaterRange>("1h");
  const [collectedWater, setCollectedWater] = useState<PlatformSnapshot["water"]>([]);
  const [collectionRunning, setCollectionRunning] = useState(false);
  const [collectionTotal, setCollectionTotal] = useState(0);
  const collectionTimerRef = useRef<number | null>(null);
  const latest = collectedWater.at(-1);
  const latestDissolvedOxygen = latest?.dissolvedOxygen ?? null;
  const latestAmmoniaNitrogen = latest?.ammoniaNitrogen ?? null;
  const latestConductivity = latest?.conductivity ?? null;
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
    setCollectedWater([]);
    setCollectionTotal(96);
    setCollectionRunning(true);

    let source: PlatformSnapshot["water"] = [];
    try {
      const result = await generateSimulation(96);
      source = result.snapshot.water.slice(-result.count);
    } catch {
      source = snapshot.water.slice(-96);
    }

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
    });
  }

  return (
    <PageFrame>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <PageHeader kicker="Water Intelligence" title="环境监测" description="水质数据、历史趋势、数据采集和智能分析报告集中在同一模块。" />
        <ActionButton
          icon={Play}
          label={collectionRunning ? "采集中" : "数据采集"}
          onClick={handleHeaderCollection}
          disabled={collectionRunning}
          primary
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="水温" value={latest?.waterTemperature} suffix="°C" decimals={1} detail="参考适宜 22-30°C" icon={Waves} />
        <MetricCard label="浊度" value={latest?.turbidity} suffix="NTU" decimals={1} detail={latest ? waterStatusLabel[latest.status] : ""} icon={Gauge} />
        <MetricCard label="pH" value={latest?.ph} decimals={2} detail="参考区间 6.8-8.5" icon={CheckCircle2} />
        <MetricCard label="溶解氧" value={latestDissolvedOxygen} suffix="mg/L" decimals={1} detail="淡水养殖建议 ≥5 mg/L" icon={CheckCircle2} tone="good" />
        <MetricCard label="氨氮" value={latestAmmoniaNitrogen} suffix="mg/L" decimals={2} detail="建议控制在 0.20 mg/L 以下" icon={Gauge} tone="watch" />
        <MetricCard label="电导率" value={latestConductivity} suffix="μS/cm" decimals={0} detail="淡水参考 200-800 μS/cm" icon={Waves} />
      </div>

      <section className="rounded-3xl border border-app-line bg-white p-6 shadow-soft">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink-900">核心趋势图</h2>
            <p className="mt-2 text-sm text-ink-500">
              {collectionRunning ? `采集中 ${visibleWater.length} / ${collectionTotal} 个采样点` : visibleWater.length > 0 ? `已采集 ${visibleWater.length} 个采样点` : "等待数据采集"}
            </p>
          </div>
          <div className="flex w-fit rounded-2xl border border-app-line bg-app-subtle p-1">
            {waterRangeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedRange(option.value)}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  selectedRange === option.value
                    ? "bg-white text-harbor-600 shadow-sm"
                    : "text-ink-500 hover:text-ink-900"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <CoreWaterTrendChart chartData={chartData} visualReady={visualReady} />

        {collectionTotal > 0 ? (
          <div className="mt-5 h-2 overflow-hidden rounded-full bg-app-subtle">
            <div
              className="h-full rounded-full bg-harbor-500 transition-all duration-150"
              style={{ width: `${Math.min(100, (visibleWater.length / collectionTotal) * 100)}%` }}
            />
          </div>
        ) : null}

        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <WaterChartPanel
            title="颗粒与污染物"
            chartData={chartData}
            visualReady={visualReady}
            height={260}
            lines={[
              { dataKey: "浊度", stroke: "#5f8f72" },
              { dataKey: "氨氮", stroke: "#dc8a32" },
            ]}
          />
          <WaterChartPanel
            title="电导率"
            chartData={chartData}
            visualReady={visualReady}
            height={260}
            lines={[
              { dataKey: "电导率", stroke: "#7c6f64" },
            ]}
          />
        </div>
      </section>

      <WaterAnalysisSection
        snapshot={snapshot}
        visualReady={visualReady}
        waterForAnalysis={collectedWater}
        collecting={collectionRunning}
      />
    </PageFrame>
  );
}

function CoreWaterTrendChart({ chartData, visualReady }: { chartData: WaterChartDatum[]; visualReady: boolean }) {
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-900">水温 / 溶解氧 / pH</h3>
          <p className="mt-1 text-xs font-semibold text-ink-500">左轴：水温与溶解氧，右轴：pH</p>
        </div>
        <ChartLegend lines={lines} />
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

function WaterChartPanel({
  title,
  chartData,
  visualReady,
  lines,
  height = 280,
}: {
  title: string;
  chartData: WaterChartDatum[];
  visualReady: boolean;
  lines: WaterChartLine[];
  height?: number;
}) {
  return (
    <div className="min-h-[300px] rounded-3xl border border-app-line bg-app-subtle p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-soft">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink-700">{title}</h3>
        <ChartLegend lines={lines} />
      </div>
      <div style={{ height }}>
        {!visualReady ? (
          <EmptyPanel text="图表初始化中" />
        ) : chartData.length === 0 ? (
          <EmptyPanel text="等待数据采集" />
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={260} minHeight={220}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="#dfe6ee" vertical={false} />
              <XAxis dataKey="time" stroke="#667085" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#667085" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip content={<WaterTooltip />} />
              {lines.map((line) => (
                <Line key={line.dataKey} type="monotone" dataKey={line.dataKey} stroke={line.stroke} strokeWidth={2.4} dot={false} />
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
}: {
  snapshot: ReturnType<typeof usePlatformData>["snapshot"];
  visualReady: boolean;
  waterForAnalysis?: PlatformSnapshot["water"];
  collecting?: boolean;
}) {
  const [status, setStatus] = useState<{ configured: boolean; model: string; hasReport: boolean } | null>(null);
  const [report, setReport] = useState<AIReport | null>(null);
  const [message, setMessage] = useState("尚未生成预测报告");
  const [busy, setBusy] = useState(false);
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

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <StatusBadge text={status?.configured ? "大模型已配置" : "未配置大模型，使用本地预测"} tone={status?.configured ? "good" : "neutral"} />
          <StatusBadge text={message} tone={report ? "good" : "neutral"} />
        </div>
        <div className="flex flex-wrap gap-3">
          <ActionButton icon={Bot} label="生成预测报告" onClick={handleGenerate} disabled={busy || collecting} primary />
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

export function HealthPage() {
  const { snapshot } = usePlatformData();
  const [checking, setChecking] = useState(false);
  const [warningResult, setWarningResult] = useState<{
    checkedAt: string;
    issues: string[];
  } | null>(null);

  function handleWarningCheck() {
    setChecking(true);
    window.setTimeout(() => {
      setWarningResult({
        checkedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        issues: collectHealthWarnings(snapshot),
      });
      setChecking(false);
    }, 450);
  }

  return (
    <PageFrame>
      <PageHeader kicker="Vessel Health" title="船舶健康管理" description="能源、电控、通信与传感器状态独立展示，适合比赛答辩时逐项说明。" />
      <section className={`rounded-3xl border p-6 shadow-soft ${
        warningResult && warningResult.issues.length > 0
          ? "border-red-200 bg-red-50/80"
          : "border-app-line bg-white"
      }`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink-900">设备预警检测</h2>
            <p className={`mt-2 text-sm ${
              warningResult && warningResult.issues.length > 0 ? "text-red-600" : "text-ink-500"
            }`}>
              {warningResult
                ? warningResult.issues.length > 0
                  ? `发现 ${warningResult.issues.length} 项异常`
                  : "未发现异常"
                : "点击按钮开始检测当前设备状态"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleWarningCheck}
            disabled={checking}
            className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
              warningResult && warningResult.issues.length > 0
                ? "bg-red-600 text-white hover:bg-red-500"
                : "bg-harbor-600 text-white hover:bg-harbor-500"
            }`}
          >
            <CheckCircle2 className="h-4 w-4" />
            {checking ? "检测中" : "开始预警检测"}
          </button>
        </div>

        {warningResult ? (
          <div className="mt-5 rounded-2xl bg-white/70 p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-semibold text-ink-700">检测时间</span>
              <span className="text-ink-500">{warningResult.checkedAt}</span>
            </div>
            {warningResult.issues.length > 0 ? (
              <ul className="mt-4 space-y-2 text-sm text-red-700">
                {warningResult.issues.map((issue) => (
                  <li key={issue} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-sage-500">电池、电控、通信和传感器状态均正常。</p>
            )}
          </div>
        ) : null}
      </section>
      <div className="grid gap-5 md:grid-cols-3">
        {snapshot.batteries.map((battery) => {
          const abnormal = battery.status !== "online";

          return (
          <div key={battery.id} className={`rounded-3xl border p-7 shadow-soft ${healthCardClass(battery.status)}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm font-semibold ${abnormal ? "text-red-600" : "text-ink-500"}`}>电池 {battery.id}</p>
                <strong className={`mt-3 block text-4xl font-semibold ${abnormal ? "text-red-700" : "text-ink-900"}`}>{battery.percentage}%</strong>
              </div>
              <Battery className={`h-8 w-8 ${abnormal ? "text-red-600" : "text-harbor-600"}`} />
            </div>
            <div className="mt-8 h-2 overflow-hidden rounded-full bg-app-subtle">
              <div className={`h-full rounded-full ${abnormal ? "bg-red-500" : "bg-harbor-500"}`} style={{ width: `${battery.percentage}%` }} />
            </div>
            <div className="mt-5 flex items-center justify-between text-sm">
              <span className="text-ink-500">{battery.voltage.toFixed(1)} V</span>
              <StatusPill status={battery.status} />
            </div>
          </div>
          );
        })}
      </div>
      <section className="grid gap-4 md:grid-cols-2">
        {[
          ["主控开发板", snapshot.vessel.esp32],
          ["飞控模块", snapshot.vessel.pixhawk],
          ["通信模块", snapshot.vessel.communication],
          ["传感器状态", snapshot.vessel.sensor],
        ].map(([label, status]) => {
          const deviceStatus = status as DeviceStatus;
          const abnormal = deviceStatus !== "online";

          return (
          <div key={label} className={`flex items-center justify-between rounded-3xl border p-6 shadow-soft ${healthCardClass(deviceStatus)}`}>
            <div className="flex items-center gap-4">
              <div className={`grid h-11 w-11 place-items-center rounded-2xl ${abnormal ? "bg-red-100 text-red-600" : "bg-app-subtle text-ink-700"}`}>
                <Cpu className="h-5 w-5" />
              </div>
              <strong className={abnormal ? "text-red-700" : "text-ink-900"}>{label}</strong>
            </div>
            <StatusPill status={deviceStatus} />
          </div>
          );
        })}
      </section>
    </PageFrame>
  );
}

export function NavigationPage() {
  const { snapshot } = usePlatformData();
  const nav = snapshot.navigation;
  return (
    <PageFrame wide>
      <PageHeader kicker="Navigation" title="智能航行决策" description="地图、航迹和航行参数独立展示，后续可接入飞控航行数据。" />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="h-[560px] overflow-hidden rounded-[28px] border border-app-line bg-white shadow-soft">
          <NavigationMap navigation={nav} />
        </div>
        <div className="space-y-4">
          <InfoPanel label="当前位置" value={`${nav.position.lat.toFixed(5)}, ${nav.position.lng.toFixed(5)}`} />
          <InfoPanel label="当前速度" value={`${nav.speed.toFixed(2)} m/s`} />
          <InfoPanel label="当前航向" value={`${nav.heading}°`} />
          <InfoPanel label="剩余航程" value={`${nav.remainingDistance.toFixed(2)} km`} />
          <InfoPanel label="预计到达" value={`${nav.etaMinutes} min`} />
        </div>
      </div>
    </PageFrame>
  );
}

export function ServosPage() {
  const [servos, setServos] = useState<ServoSnapshot | null>(null);
  const [propulsion, setPropulsion] = useState<PropulsionSnapshot | null>(null);
  const [draftAngles, setDraftAngles] = useState<Record<string, number[]>>({});
  const [expandedBoards, setExpandedBoards] = useState<Record<string, boolean>>({});
  const [editingServo, setEditingServo] = useState<string | null>(null);
  const [manualInputs, setManualInputs] = useState<Record<string, string>>({});
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [motorPower, setMotorPower] = useState(20);
  const [motorTargetPower, setMotorTargetPower] = useState(0);
  const [motorBusy, setMotorBusy] = useState(false);
  const [motorError, setMotorError] = useState<string | null>(null);
  const devices = servos?.devices || [];
  const onlineDevices = devices.filter((device) => device.online);
  const motorDevice = propulsion?.devices.find((device) => device.device_id === DC_MOTOR_DEVICE_ID);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const next = await getServoSnapshot();
        if (!alive) return;
        setServos(next);
        setDraftAngles((current) => {
          const merged = { ...current };
          next.devices.forEach((device) => {
            if (!merged[device.device_id]) {
              merged[device.device_id] = [...device.target_angles];
            }
          });
          return merged;
        });
      } catch {
        if (alive) setServos(null);
      }
    }

    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function refreshPropulsion() {
      try {
        const next = await getPropulsionSnapshot();
        if (alive) setPropulsion(next);
      } catch {
        if (alive) setPropulsion(null);
      }
    }

    refreshPropulsion();
    const timer = window.setInterval(refreshPropulsion, 2500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  function clampServoAngle(angle: number) {
    if (!Number.isFinite(angle)) return 90;
    return Math.min(180, Math.max(0, Math.round(angle)));
  }

  function setDraft(deviceId: string, channelIndex: number, angle: number) {
    setDraftAngles((current) => {
      const next = current[deviceId] ? [...current[deviceId]] : [90, 90, 90, 90];
      next[channelIndex] = clampServoAngle(angle);
      return { ...current, [deviceId]: next };
    });
  }

  async function submitChannel(deviceId: string, channelIndex: number, angle: number) {
    const nextAngle = clampServoAngle(angle);
    const key = `${deviceId}-${channelIndex}`;
    setBusy(true);
    try {
      const result = await setServoChannel(deviceId, channelIndex + 1, nextAngle);
      setServos(result.servos);
      setFlashKey(key);
      window.setTimeout(() => setFlashKey((current) => current === key ? null : current), 420);
    } finally {
      setBusy(false);
    }
  }

  async function setAllAngles(angle: number) {
    const nextAngle = clampServoAngle(angle);
    const activeDevices = onlineDevices.length > 0 ? onlineDevices : [];
    setBusy(true);
    try {
      const results = await Promise.all(activeDevices.map((device) => setServoAngles(device.device_id, [nextAngle, nextAngle, nextAngle, nextAngle])));
      const latest = results.at(-1);
      if (latest) setServos(latest.servos);
      setDraftAngles((current) => ({
        ...current,
        ...Object.fromEntries(activeDevices.map((device) => [device.device_id, [nextAngle, nextAngle, nextAngle, nextAngle]])),
      }));
    } finally {
      setBusy(false);
    }
  }

  async function sendMotorCommand(power: number, enabled: boolean, emergencyStop = false) {
    setMotorBusy(true);
    setMotorError(null);
    try {
      const result = await setPropulsionTarget({
        device_id: DC_MOTOR_DEVICE_ID,
        mode: "WEB",
        enabled,
        emergency_stop: emergencyStop,
        throttle: power,
        steering: 0,
        max_power: motorPower,
      });
      setPropulsion(result.propulsion);
    } catch (error) {
      setMotorError(error instanceof Error ? error.message : "电机命令发送失败");
    } finally {
      setMotorBusy(false);
    }
  }

  useEffect(() => {
    if (motorTargetPower === 0) return;

    const send = () => {
      void sendMotorCommand(motorTargetPower, true);
    };
    send();
    const timer = window.setInterval(send, 800);
    return () => window.clearInterval(timer);
  }, [motorTargetPower]);

  function startMotor(direction: 1 | -1) {
    if (!motorDevice?.online) {
      setMotorError("电机控制板未在线");
      return;
    }
    setMotorError(null);
    setMotorTargetPower(direction * motorPower);
  }

  function stopMotor() {
    setMotorTargetPower(0);
    void sendMotorCommand(0, false);
  }

  function emergencyStopMotor() {
    setMotorTargetPower(0);
    void sendMotorCommand(0, false, true);
  }

  return (
    <PageFrame wide>
      <section className="rounded-[28px] bg-[#0f172a] p-5 text-slate-100 shadow-soft md:p-7">
        <div className="flex flex-col gap-5 rounded-3xl border border-slate-700 bg-slate-800/82 p-5 shadow-[0_24px_70px_rgba(2,6,23,0.25)] md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-slate-100 md:text-3xl">水上执行机构</h1>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              {devices.length > 0 ? devices.map((device, index) => (
                <ServoOnlineDot key={device.device_id} label={`servo${index + 1}`} online={device.online} />
              )) : (
                <ServoOnlineDot label="接口连接中" online={false} />
              )}
              <span className="text-sm font-semibold text-slate-300">
                {servos ? `${servos.online_count}/${servos.device_count} 控制板在线` : "正在连接控制板"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <ServoConsoleButton
              label="全部复位 0°"
              onClick={() => setAllAngles(0)}
              disabled={busy || onlineDevices.length === 0}
              variant="outline"
            />
            <ServoConsoleButton
              label="全部归中 90°"
              onClick={() => setAllAngles(90)}
              disabled={busy || onlineDevices.length === 0}
              variant="primary"
            />
          </div>
        </div>

       <div className="mt-6 grid gap-6">
        {devices.map((device, boardIndex) => {
          const angles = draftAngles[device.device_id] || device.target_angles;
          const expanded = expandedBoards[device.device_id] ?? true;
          return (
            <section
              key={device.device_id}
              className={`relative overflow-hidden rounded-3xl border border-slate-700 bg-slate-800 p-5 shadow-[0_18px_58px_rgba(2,6,23,0.32)] transition ${
                device.online ? "opacity-100" : "opacity-45"
              }`}
            >
              <button
                type="button"
                onClick={() => setExpandedBoards((current) => ({ ...current, [device.device_id]: !expanded }))}
                className="flex w-full flex-col gap-3 border-b border-slate-700 pb-5 text-left sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <h2 className="text-xl font-semibold text-slate-100">servo{boardIndex + 1}</h2>
                  <p className="mt-1 text-sm text-slate-400">四路舵机输出</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    device.online ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-slate-500/25 bg-slate-600/20 text-slate-400"
                  }`}>
                    <span className={`h-2 w-2 rounded-full ${device.online ? "bg-emerald-400" : "bg-slate-500"}`} />
                    {device.online ? "在线" : "离线"}
                  </span>
                  <span className="text-sm font-semibold text-slate-400">{expanded ? "收起" : "展开"}</span>
                </div>
              </button>

              {expanded ? (
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                {[0, 1, 2, 3].map((index) => {
                  const angle = angles[index] ?? 90;
                  const servoKey = `${device.device_id}-${index}`;
                  const disabled = busy || !device.online;
                  return (
                    <ServoControlUnit
                      key={index}
                      boardIndex={boardIndex}
                      channelIndex={index}
                      angle={angle}
                      actualAngle={device.actual_angles[index]}
                      disabled={disabled}
                      editing={editingServo === servoKey}
                      manualValue={manualInputs[servoKey] ?? String(angle)}
                      flashed={flashKey === servoKey}
                      onEditStart={() => {
                        setEditingServo(servoKey);
                        setManualInputs((current) => ({ ...current, [servoKey]: String(angle) }));
                      }}
                      onManualChange={(value) => setManualInputs((current) => ({ ...current, [servoKey]: value }))}
                      onManualCommit={() => {
                        const next = clampServoAngle(Number(manualInputs[servoKey] ?? angle));
                        setDraft(device.device_id, index, next);
                        setEditingServo(null);
                        submitChannel(device.device_id, index, next);
                      }}
                      onManualCancel={() => setEditingServo(null)}
                      onSetAngle={(nextAngle) => {
                        const next = clampServoAngle(nextAngle);
                        setDraft(device.device_id, index, next);
                        submitChannel(device.device_id, index, next);
                      }}
                      onDraftAngle={(nextAngle) => setDraft(device.device_id, index, nextAngle)}
                    />
                  );
                })}
              </div>
              ) : null}
              {!device.online ? (
                <div className="pointer-events-none absolute inset-x-5 top-[92px] z-10 rounded-2xl border border-slate-600 bg-slate-950/58 px-4 py-3 text-center text-sm font-semibold text-slate-300 backdrop-blur-sm">
                  离线
                </div>
              ) : null}
            </section>
          );
        })}
       </div>

        <section className="mt-6 rounded-3xl border border-slate-700 bg-slate-800 p-5 shadow-[0_18px_58px_rgba(2,6,23,0.32)]">
          <div className="flex flex-col gap-3 border-b border-slate-700 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-100">驱动电机</h2>
              <p className="mt-1 text-sm text-slate-400">37GB555 · M0 输出</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                motorDevice?.online
                  ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
                  : "border-slate-500/25 bg-slate-600/20 text-slate-400"
              }`}>
                <span className={`h-2 w-2 rounded-full ${motorDevice?.online ? "bg-emerald-400" : "bg-slate-500"}`} />
                {motorDevice?.online ? "在线" : "离线"}
              </span>
              <span className="text-sm font-semibold text-slate-400">控制板：{DC_MOTOR_DEVICE_ID}</span>
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div>
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="dc-motor-power" className="text-sm font-semibold text-slate-200">目标功率</label>
                <span className="text-2xl font-semibold tabular-nums text-cyan-300">{motorPower}%</span>
              </div>
              <input
                id="dc-motor-power"
                type="range"
                min="5"
                max={DC_MOTOR_MAX_POWER}
                step="1"
                value={motorPower}
                onChange={(event) => {
                  const nextPower = Number(event.target.value);
                  setMotorPower(nextPower);
                  if (motorTargetPower !== 0) {
                    setMotorTargetPower(Math.sign(motorTargetPower) * nextPower);
                  }
                }}
                disabled={motorBusy}
                className="servo-range mt-5 w-full"
              />
              <div className="mt-2 flex justify-between text-xs font-semibold text-slate-500">
                <span>5%</span>
                <span>固件上限 {DC_MOTOR_MAX_POWER}%</span>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => startMotor(1)}
                  disabled={motorBusy || !motorDevice?.online}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-emerald-400/40 bg-emerald-400/12 px-3 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUp size={17} aria-hidden="true" />
                  正转
                </button>
                <button
                  type="button"
                  onClick={stopMotor}
                  disabled={motorBusy || !motorDevice?.online}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-600 bg-slate-900/35 px-3 py-3 text-sm font-semibold text-slate-200 transition hover:border-cyan-400/70 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <CircleStop size={17} aria-hidden="true" />
                  停止
                </button>
                <button
                  type="button"
                  onClick={() => startMotor(-1)}
                  disabled={motorBusy || !motorDevice?.online}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-amber-400/40 bg-amber-400/12 px-3 py-3 text-sm font-semibold text-amber-200 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowDown size={17} aria-hidden="true" />
                  反转
                </button>
              </div>

              <button
                type="button"
                onClick={emergencyStopMotor}
                disabled={motorBusy}
                className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-rose-400/45 bg-rose-500/15 px-4 py-3 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ShieldAlert size={17} aria-hidden="true" />
                急停
              </button>
              {motorError ? <p className="mt-3 text-sm font-semibold text-rose-300">{motorError}</p> : null}
            </div>

            <div className="grid content-start gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <MotorStatusItem label="当前输出" value={`${motorDevice?.actual_left_power ?? 0}%`} />
              <MotorStatusItem label="目标输出" value={`${motorTargetPower > 0 ? "+" : ""}${motorTargetPower}%`} />
              <MotorStatusItem label="运行模式" value={motorTargetPower === 0 ? "停止" : motorTargetPower > 0 ? "正转" : "反转"} />
            </div>
          </div>
        </section>
      </section>
    </PageFrame>
  );
}

function MotorStatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-900/35 px-4 py-3">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{value}</p>
    </div>
  );
}

function ServoOnlineDot({ label, online }: { label: string; online: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-300">
      <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)]" : "bg-slate-500"}`} />
      {label}
    </span>
  );
}

function ServoConsoleButton({
  label,
  onClick,
  disabled,
  variant,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant: "primary" | "outline";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-2xl px-5 py-3 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ${
        variant === "primary"
          ? "border border-cyan-400 bg-cyan-500 text-slate-950 shadow-[0_0_18px_rgba(6,182,212,0.36)] hover:bg-cyan-400"
          : "border border-slate-600 bg-transparent text-slate-200 hover:border-cyan-400/70 hover:text-cyan-200"
      }`}
    >
      {label}
    </button>
  );
}

function ServoControlUnit({
  boardIndex,
  channelIndex,
  angle,
  actualAngle,
  disabled,
  editing,
  manualValue,
  flashed,
  onEditStart,
  onManualChange,
  onManualCommit,
  onManualCancel,
  onSetAngle,
  onDraftAngle,
}: {
  boardIndex: number;
  channelIndex: number;
  angle: number;
  actualAngle: number | null;
  disabled: boolean;
  editing: boolean;
  manualValue: string;
  flashed: boolean;
  onEditStart: () => void;
  onManualChange: (value: string) => void;
  onManualCommit: () => void;
  onManualCancel: () => void;
  onSetAngle: (angle: number) => void;
  onDraftAngle: (angle: number) => void;
}) {
  const servoNumber = boardIndex * 4 + channelIndex + 1;
  const lockedLow = angle <= 0;
  const lockedHigh = angle >= 180;
  const locked = lockedLow || lockedHigh;

  return (
    <article className="rounded-3xl border border-slate-700 bg-slate-900/72 p-4 shadow-[0_16px_42px_rgba(2,6,23,0.28)] transition hover:border-cyan-400/45 hover:shadow-[0_0_28px_rgba(6,182,212,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">舵机 {servoNumber}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${
              locked ? "border-red-400/30 bg-red-500/10 text-red-300" : "border-cyan-400/25 bg-cyan-400/10 text-cyan-200"
            }`}>
              {locked ? "锁端" : "运行"}
            </span>
            <span className="text-[11px] font-semibold text-slate-400">板端 {actualAngle ?? "--"}°</span>
          </div>
        </div>
        <div className={`text-right ${flashed ? "text-cyan-200 drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]" : locked ? "text-red-300" : "text-slate-100"}`}>
          {editing ? (
            <input
              className="w-24 rounded-xl border border-cyan-400 bg-slate-950 px-3 py-2 text-right text-2xl font-semibold text-cyan-100 outline-none"
              type="number"
              min={0}
              max={180}
              value={manualValue}
              autoFocus
              onChange={(event) => onManualChange(event.target.value)}
              onBlur={onManualCommit}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") onManualCancel();
              }}
            />
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={onEditStart}
              className="rounded-xl text-right text-4xl font-semibold tracking-normal transition hover:text-cyan-200 disabled:cursor-not-allowed"
              title="点击输入精确角度"
            >
              {angle}<span className="ml-1 text-lg text-slate-400">°</span>
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[170px_minmax(0,1fr)] md:items-center">
        <ServoAngleGauge angle={angle} lockedLow={lockedLow} lockedHigh={lockedHigh} />
        <div className="space-y-4">
          <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-3">
            <button
              type="button"
              disabled={disabled || lockedLow}
              onClick={() => onSetAngle(angle - 1)}
              className="rounded-xl border border-slate-600 bg-slate-800 px-2 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-35"
            >
              -1°
            </button>
            <input
              className="servo-range w-full"
              style={{
                background: `linear-gradient(90deg, #06b6d4 0%, #22d3ee ${(angle / 180) * 100}%, #334155 ${(angle / 180) * 100}%, #334155 100%)`,
              }}
              type="range"
              min={0}
              max={180}
              step={1}
              value={angle}
              disabled={disabled}
              onChange={(event) => onDraftAngle(Number(event.target.value))}
              onPointerUp={(event) => onSetAngle(Number(event.currentTarget.value))}
            />
            <button
              type="button"
              disabled={disabled || lockedHigh}
              onClick={() => onSetAngle(angle + 1)}
              className="rounded-xl border border-slate-600 bg-slate-800 px-2 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-35"
            >
              +1°
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[0, 45, 90, 180].map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={disabled}
                onClick={() => onSetAngle(preset)}
                className={`rounded-full border px-3 py-2 text-xs font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 ${
                  angle === preset
                    ? "border-cyan-400 bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.32)]"
                    : "border-slate-600 bg-slate-800 text-slate-300 hover:border-cyan-400/70 hover:text-cyan-100"
                }`}
              >
                {preset}°
              </button>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function ServoAngleGauge({ angle, lockedLow, lockedHigh }: { angle: number; lockedLow: boolean; lockedHigh: boolean }) {
  const progress = Math.max(0, Math.min(100, (angle / 180) * 100));
  const needleRotation = angle - 90;

  return (
    <svg viewBox="0 0 184 108" className="h-28 w-full overflow-visible">
      <path d="M20 92 A72 72 0 0 1 164 92" pathLength={100} fill="none" stroke="#334155" strokeWidth={12} strokeLinecap="round" />
      <path
        d="M20 92 A72 72 0 0 1 164 92"
        pathLength={100}
        fill="none"
        stroke={lockedLow || lockedHigh ? "#ef4444" : "#06b6d4"}
        strokeWidth={12}
        strokeLinecap="round"
        strokeDasharray={`${progress} 100`}
        className={lockedLow || lockedHigh ? "drop-shadow-[0_0_8px_rgba(239,68,68,0.65)]" : "drop-shadow-[0_0_8px_rgba(6,182,212,0.55)]"}
      />
      <circle cx={20} cy={92} r={5} fill={lockedLow ? "#ef4444" : "#64748b"} />
      <circle cx={164} cy={92} r={5} fill={lockedHigh ? "#ef4444" : "#64748b"} />
      <line
        x1={92}
        y1={92}
        x2={92}
        y2={33}
        stroke="#e2e8f0"
        strokeWidth={4}
        strokeLinecap="round"
        transform={`rotate(${needleRotation} 92 92)`}
      />
      <circle cx={92} cy={92} r={8} fill="#06b6d4" />
      <text x={20} y={106} fill="#94a3b8" fontSize={10} textAnchor="middle">0°</text>
      <text x={164} y={106} fill="#94a3b8" fontSize={10} textAnchor="middle">180°</text>
    </svg>
  );
}

export function LogsPage() {
  const [logs, setLogs] = useState<SystemLog[]>([]);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const next = await getSystemLogs();
        if (alive) setLogs(next);
      } catch {
        if (alive) setLogs([]);
      }
    }
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <PageFrame>
      <PageHeader kicker="System Logs" title="系统日志" description="集中记录传感器、智能报告、舵机控制板和后端服务事件。" />
      <section className="rounded-3xl border border-app-line bg-white p-6 shadow-soft">
        {logs.length === 0 ? (
          <EmptyPanel text="暂无系统日志" />
        ) : (
          <div className="soft-scrollbar max-h-[620px] overflow-auto">
            {logs.map((log) => (
              <article key={log.id} className="grid gap-3 border-b border-app-line py-5 last:border-b-0 md:grid-cols-[120px_minmax(0,1fr)_120px]">
                <StatusBadge text={logLevelLabel(log.level)} tone={log.level === "success" ? "good" : log.level === "warning" || log.level === "error" ? "warn" : "neutral"} />
                <div>
                  <strong className="text-sm">{log.title}</strong>
                  <p className="mt-2 text-sm leading-6 text-ink-500">{log.detail}</p>
                </div>
                <time className="text-sm text-ink-500 md:text-right">
                  {new Date(log.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </time>
              </article>
            ))}
          </div>
        )}
      </section>
    </PageFrame>
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
        <InfoPanel label="续航估计" value={`${report.forecast.batteryRuntimeHours.toFixed(1)} 小时`} />
      </div>

      <p className="mt-8 rounded-2xl bg-app-subtle p-5 text-sm leading-7 text-ink-500">{report.dataQuality}</p>
    </section>
  );
}

function TwinHeaderStatus({ icon: Icon, label, value, tone = "neutral" }: { icon: typeof Gauge; label: string; value: string; tone?: "neutral" | "good" | "danger" }) {
  const toneClass = tone === "good" ? "text-sage-500" : tone === "danger" ? "text-red-600" : "text-harbor-600";

  return (
    <div className="flex min-w-[142px] items-center gap-3 px-4 py-1.5 first:pl-0 sm:first:pl-4">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-harbor-100 ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-ink-500/80">{label}</p>
        <strong className={`mt-0.5 block truncate text-sm font-semibold ${tone === "neutral" ? "text-ink-900" : toneClass}`}>{value}</strong>
      </div>
    </div>
  );
}

function TwinKeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-app-line pb-3 last:border-b-0 last:pb-0">
      <span className="text-sm font-semibold text-ink-500">{label}</span>
      <strong className="text-right text-sm font-semibold text-ink-900">{value}</strong>
    </div>
  );
}

function TwinMetricItem({ icon: Icon, label, value, unit }: { icon: typeof Gauge; label: string; value: string; unit: string }) {
  return (
    <div className="rounded-2xl border border-white bg-white/75 p-4 shadow-[0_10px_32px_rgba(50,91,109,0.055)]">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink-500">
        <Icon className="h-3.5 w-3.5 text-harbor-600" />
        {label}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <strong className="text-2xl font-semibold tracking-normal text-ink-900">{value}</strong>
        {unit ? <span className="text-xs font-semibold text-ink-500">{unit}</span> : null}
      </div>
    </div>
  );
}

function TwinMiniTrend({
  data,
  dataKey,
  label,
  value,
  unit,
  color,
  gradientId,
}: {
  data: Array<{ point: number; speed: number; battery: number }>;
  dataKey: "speed" | "battery";
  label: string;
  value: string;
  unit: string;
  color: string;
  gradientId: string;
}) {
  const visualReady = useVisualReady();

  return (
    <div className="min-w-0 rounded-2xl border border-mist-200 bg-mist-50 px-4 pb-3 pt-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-ink-500">{label}</p>
          <div className="mt-1 flex items-baseline gap-1">
            <strong className="text-2xl font-semibold tracking-normal text-ink-900">{value}</strong>
            <span className="text-xs font-semibold text-ink-500">{unit}</span>
          </div>
        </div>
        <span className="mb-1 h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      </div>
      <div className="mt-2 h-24 w-full">
        {visualReady ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={data} margin={{ top: 8, right: 2, bottom: 2, left: 2 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.24} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <Tooltip
                cursor={{ stroke: "#c9e0e5", strokeWidth: 1 }}
                contentStyle={{ border: "1px solid #dbe9ed", borderRadius: 10, boxShadow: "0 12px 30px rgba(42,85,102,0.08)", fontSize: 12 }}
                formatter={(nextValue) => [`${Number(nextValue).toFixed(dataKey === "speed" ? 2 : 1)} ${unit}`, label]}
                labelFormatter={() => "最近航行采样"}
              />
              <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.2} fill={`url(#${gradientId})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full rounded-xl bg-mist-100" />
        )}
      </div>
    </div>
  );
}

function TwinFeedbackBar({
  viewMode,
  onViewModeChange,
  onResetView,
  connected,
  online,
  feedbackTime,
  liveOcean,
  onToggleLiveOcean,
}: {
  viewMode: TwinViewMode;
  onViewModeChange: (mode: TwinViewMode) => void;
  onResetView: () => void;
  connected: boolean;
  online: boolean;
  feedbackTime: string;
  liveOcean: boolean;
  onToggleLiveOcean: () => void;
}) {
  const options: Array<{ value: TwinViewMode; label: string }> = [
    { value: "follow", label: "跟随" },
    { value: "top", label: "俯视" },
    { value: "front", label: "正视" },
  ];

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-mist-200 bg-white p-1" aria-label="数字孪生视角">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onViewModeChange(option.value)}
              className={`min-h-9 rounded-lg px-4 text-sm font-semibold transition ${
                viewMode === option.value ? "bg-harbor-600 text-white" : "text-ink-500 hover:bg-harbor-100 hover:text-harbor-600"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onResetView}
          className="grid h-11 w-11 place-items-center rounded-xl border border-mist-200 bg-white text-ink-700 transition hover:border-mist-300 hover:text-harbor-600"
          title="视角复位"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onToggleLiveOcean}
          className={`grid h-11 w-11 place-items-center rounded-xl border transition ${
            liveOcean
              ? "border-harbor-500 bg-harbor-100 text-harbor-600"
              : "border-mist-200 bg-white text-ink-500 hover:border-mist-300 hover:text-harbor-600"
          }`}
          title={liveOcean ? "实时水面：开启（点击关闭以提升性能）" : "实时水面：关闭（点击开启）"}
          aria-pressed={liveOcean}
        >
          <Waves className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold text-ink-500" aria-live="polite">
        <span className="inline-flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-500" : connected ? "bg-amber-400" : "bg-red-500"}`} />
          {!connected ? "状态接口不可达" : online ? "真实反馈驱动中" : "等待 ESP32 状态"}
        </span>
        <span>最近反馈 {feedbackTime}</span>
      </div>
    </div>
  );
}

function TwinDeviceFeedbackPanel({
  servoDevices,
  motorDevice,
  connected,
}: {
  servoDevices: Array<ServoDevice | undefined>;
  motorDevice?: PropulsionDevice;
  connected: boolean;
}) {
  const channels = servoDevices.flatMap((device, boardIndex) =>
    Array.from({ length: 4 }, (_value, channelIndex) => ({ device, boardIndex, channelIndex })),
  );
  const motorActual = motorDevice?.actual_left_power ?? 0;
  const motorTarget = motorDevice?.target.left_power ?? 0;
  const motorState = !motorDevice?.online
    ? "离线"
    : motorDevice.emergency_stop
      ? "急停"
      : Math.abs(motorActual) <= 4
        ? "停止"
        : motorActual > 0
          ? "伸出 / 正转"
          : "收回 / 反转";

  return (
    <section className="rounded-[24px] border border-mist-200 bg-white p-6 shadow-[0_18px_52px_rgba(45,84,101,0.065)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mist-200 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">执行机构真实反馈</h2>
          <p className="mt-1 text-xs font-semibold text-ink-500">3D 机构只读取设备上报的实际值</p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
          connected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
        }`}>
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
          {connected ? "状态接口已连接" : "状态接口不可达"}
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {channels.map(({ device, boardIndex, channelIndex }) => {
          const actual = device?.actual_angles[channelIndex] ?? null;
          const target = device?.target_angles[channelIndex] ?? 90;
          const hasFeedback = Boolean(device?.online && actual !== null);
          return (
            <div key={`${boardIndex}-${channelIndex}`} className="rounded-xl border border-mist-200 bg-mist-50 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink-500">S{boardIndex * 4 + channelIndex + 1}</span>
                <span className={`h-2 w-2 rounded-full ${hasFeedback ? "bg-emerald-500" : "bg-slate-300"}`} />
              </div>
              <strong className={`mt-2 block text-xl font-semibold tabular-nums ${hasFeedback ? "text-ink-900" : "text-slate-400"}`}>
                {hasFeedback ? `${actual}°` : "--"}
              </strong>
              <p className="mt-1 text-[11px] font-semibold text-ink-500">目标 {target}°</p>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-3 border-t border-mist-200 pt-5 sm:grid-cols-2 lg:grid-cols-4">
        <TwinFeedbackValue label="M0 实际 PWM" value={`${motorActual}%`} active={Boolean(motorDevice?.online)} />
        <TwinFeedbackValue label="M0 目标 PWM" value={`${motorTarget}%`} active={Boolean(motorDevice?.online)} />
        <TwinFeedbackValue label="M0 运行状态" value={motorState} active={Boolean(motorDevice?.online)} />
        <TwinFeedbackValue label="推杆位置反馈" value="未接入" active={false} warning />
      </div>
    </section>
  );
}

function TwinFeedbackValue({ label, value, active, warning = false }: { label: string; value: string; active: boolean; warning?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-mist-50 px-4 py-3">
      <span className="text-xs font-semibold text-ink-500">{label}</span>
      <strong className={`text-sm font-semibold tabular-nums ${warning ? "text-amber-600" : active ? "text-ink-900" : "text-slate-400"}`}>{value}</strong>
    </div>
  );
}

function TwinPredictionWorkbench({
  mode,
  input,
  result,
  running,
  error,
  onModeChange,
  onInputChange,
  onRun,
}: {
  mode: TwinSimulationMode;
  input: TwinSimulationInput;
  result: TwinSimulationResult | null;
  running: boolean;
  error: string;
  onModeChange: (mode: TwinSimulationMode) => void;
  onInputChange: <K extends keyof TwinSimulationInput>(key: K, value: TwinSimulationInput[K]) => void;
  onRun: () => void;
}) {
  const modes: Array<{ value: TwinSimulationMode; label: string; icon: typeof Route }> = [
    { value: "route", label: "航线预演", icon: Route },
    { value: "fault", label: "故障推演", icon: AlertTriangle },
    { value: "fatigue", label: "疲劳损耗", icon: Activity },
  ];

  return (
    <section className="overflow-hidden rounded-[24px] border border-mist-200 bg-white shadow-[0_18px_52px_rgba(45,84,101,0.065)]">
      <header className="flex flex-col gap-4 border-b border-mist-200 px-5 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-ink-900">数字孪生仿真实验台</h2>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">预测域</span>
          </div>
          <p className="mt-1 text-xs font-semibold text-ink-500">使用当前设备反馈校准模型，仿真过程不会向 ESP32 下发命令</p>
        </div>
        <div className="inline-flex w-full overflow-x-auto rounded-xl border border-mist-200 bg-mist-50 p-1 lg:w-auto" aria-label="仿真类型">
          {modes.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => onModeChange(item.value)}
                className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition lg:flex-none ${
                  mode === item.value ? "bg-white text-harbor-700 shadow-sm" : "text-ink-500 hover:text-ink-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="border-b border-mist-200 bg-mist-50/70 p-5 lg:border-b-0 lg:border-r lg:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <SlidersHorizontal className="h-4 w-4 text-harbor-600" />
            场景参数
          </div>

          {mode === "route" ? (
            <div className="mt-5 space-y-5">
              <SimulationNumberField label="预演航程" value={input.routeDistanceKm} unit="km" min={0.2} max={20} step={0.1} onChange={(value) => onInputChange("routeDistanceKm", value)} />
              <SimulationNumberField label="目标航速" value={input.targetSpeedMps} unit="m/s" min={0.2} max={3} step={0.1} onChange={(value) => onInputChange("targetSpeedMps", value)} />
              <SimulationWaveControl value={input.waveLevel} onChange={(value) => onInputChange("waveLevel", value)} />
            </div>
          ) : null}

          {mode === "fault" ? (
            <div className="mt-5 space-y-5">
              <SimulationFaultControl value={input.faultType} onChange={(value) => onInputChange("faultType", value)} />
              <label className="block">
                <span className="flex items-center justify-between text-xs font-semibold text-ink-500">
                  <span>故障严重度</span>
                  <strong className="text-ink-900">{input.faultSeverity}%</strong>
                </span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={input.faultSeverity}
                  onChange={(event) => onInputChange("faultSeverity", Number(event.target.value))}
                  className="range-soft mt-3 w-full"
                />
              </label>
              <SimulationWaveControl value={input.waveLevel} onChange={(value) => onInputChange("waveLevel", value)} />
            </div>
          ) : null}

          {mode === "fatigue" ? (
            <div className="mt-5 space-y-5">
              <SimulationNumberField label="累计运行工时" value={input.operatingHours} unit="h" min={0} max={30000} step={50} onChange={(value) => onInputChange("operatingHours", value)} />
              <SimulationNumberField label="舵机日动作次数" value={input.dailyServoCycles} unit="次" min={10} max={10000} step={10} onChange={(value) => onInputChange("dailyServoCycles", value)} />
              <SimulationWaveControl value={input.waveLevel} onChange={(value) => onInputChange("waveLevel", value)} />
            </div>
          ) : null}

          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-harbor-600 px-4 text-sm font-semibold text-white transition hover:bg-harbor-700 disabled:cursor-wait disabled:opacity-70"
          >
            {running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? "模型计算中" : "运行本次推演"}
          </button>
          <p className="mt-3 flex items-start gap-2 text-[11px] font-semibold leading-5 text-ink-500">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
            仿真结果用于决策参考，不自动接管真实设备。
          </p>
          {error ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p> : null}
        </div>

        <div className="min-w-0 p-5 lg:p-6">
          {result ? (
            <>
              {mode === "route" ? <TwinRouteResult result={result} /> : null}
              {mode === "fault" ? <TwinFaultResult result={result} /> : null}
              {mode === "fatigue" ? <TwinFatigueResult result={result} /> : null}
              <TwinSimulationProvenance result={result} />
            </>
          ) : (
            <div className="grid min-h-[390px] place-items-center text-center">
              <div className="max-w-sm">
                <FlaskConical className="mx-auto h-9 w-9 text-harbor-500" />
                <h3 className="mt-4 text-base font-semibold text-ink-900">等待运行仿真</h3>
                <p className="mt-2 text-sm leading-6 text-ink-500">设置场景参数后运行推演。服务器会读取当前设备状态，返回预测曲线、风险和模型依据。</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function SimulationNumberField({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-ink-500">{label}</span>
      <span className="mt-2 flex h-11 items-center overflow-hidden rounded-xl border border-mist-200 bg-white focus-within:border-harbor-500">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold tabular-nums text-ink-900 outline-none"
        />
        <span className="border-l border-mist-200 px-3 text-xs font-semibold text-ink-500">{unit}</span>
      </span>
    </label>
  );
}

function SimulationWaveControl({ value, onChange }: { value: TwinWaveLevel; onChange: (value: TwinWaveLevel) => void }) {
  const options: Array<{ value: TwinWaveLevel; label: string }> = [
    { value: "calm", label: "平静" },
    { value: "moderate", label: "中浪" },
    { value: "rough", label: "风浪" },
  ];
  return (
    <div>
      <span className="text-xs font-semibold text-ink-500">预设海况</span>
      <div className="mt-2 grid grid-cols-3 rounded-xl border border-mist-200 bg-white p-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`min-h-9 rounded-lg text-xs font-semibold transition ${value === option.value ? "bg-harbor-100 text-harbor-700" : "text-ink-500 hover:text-ink-900"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SimulationFaultControl({ value, onChange }: { value: TwinFaultType; onChange: (value: TwinFaultType) => void }) {
  const options: Array<{ value: TwinFaultType; label: string }> = [
    { value: "servo-stuck", label: "舵机卡滞" },
    { value: "motor-derate", label: "电机降额" },
    { value: "feedback-loss", label: "反馈丢失" },
  ];
  return (
    <div>
      <span className="text-xs font-semibold text-ink-500">注入故障</span>
      <div className="mt-2 space-y-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex min-h-10 w-full items-center justify-between rounded-xl border px-3 text-left text-xs font-semibold transition ${
              value === option.value ? "border-amber-300 bg-amber-50 text-amber-800" : "border-mist-200 bg-white text-ink-500 hover:border-mist-300"
            }`}
          >
            {option.label}
            <span className={`h-2.5 w-2.5 rounded-full ${value === option.value ? "bg-amber-500" : "bg-slate-300"}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

function TwinRouteResult({ result }: { result: TwinSimulationResult }) {
  const visualReady = useVisualReady();
  return (
    <div>
      <SimulationResultHeader icon={Route} title="航线预演结果" result={result} risk={result.route.risk} />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TwinPredictionMetric label="预计用时" value={result.route.etaMinutes.toFixed(1)} unit="min" />
        <TwinPredictionMetric label="到达电量" value={result.route.arrivalBatteryPercent.toFixed(1)} unit="%" />
        <TwinPredictionMetric label="最大横向误差" value={result.route.maxCrossTrackErrorM.toFixed(1)} unit="m" />
        <TwinPredictionMetric label="完成概率" value={`${result.route.completionProbability}`} unit="%" />
      </div>
      <div className="mt-6 h-64 min-w-0">
        {visualReady ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={result.route.series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="#e5eef1" strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="minute" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} unit="m" />
              <YAxis yAxisId="speed" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} domain={[0, "auto"]} />
              <YAxis yAxisId="battery" orientation="right" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} domain={[0, 100]} />
              <Tooltip contentStyle={{ border: "1px solid #dbe9ed", borderRadius: 10, fontSize: 12 }} labelFormatter={(value) => `第 ${value} 分钟`} />
              <Line yAxisId="speed" type="monotone" dataKey="speedMps" name="预测航速 m/s" stroke="#0f7f8a" strokeWidth={2.4} dot={false} isAnimationActive={false} />
              <Line yAxisId="battery" type="monotone" dataKey="batteryPercent" name="预测电量 %" stroke="#5f8f72" strokeWidth={2.2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="h-full rounded-xl bg-mist-100" />}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-mist-200 pt-4 text-xs font-semibold text-ink-500">
        <span>预计耗电 <strong className="text-ink-900">{result.route.energyUsedPercent}%</strong></span>
        <span>航程 <strong className="text-ink-900">{result.route.distanceKm} km</strong></span>
      </div>
    </div>
  );
}

function TwinFaultResult({ result }: { result: TwinSimulationResult }) {
  const visualReady = useVisualReady();
  return (
    <div>
      <SimulationResultHeader icon={AlertTriangle} title={result.fault.title} result={result} risk={result.fault.risk} />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TwinPredictionMetric label="航速损失" value={result.fault.speedLossPercent.toFixed(1)} unit="%" />
        <TwinPredictionMetric label="航向漂移" value={result.fault.headingDriftDeg.toFixed(1)} unit="°" />
        <TwinPredictionMetric label="故障检出" value={`${result.fault.detectionSeconds}`} unit="s" />
        <TwinPredictionMetric label="任务完成概率" value={`${result.fault.completionProbability}`} unit="%" />
      </div>
      <div className="mt-6 h-60 min-w-0">
        {visualReady ? (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={result.fault.series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="#e5eef1" strokeDasharray="3 5" vertical={false} />
              <XAxis dataKey="minute" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} unit="m" />
              <YAxis tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} domain={[0, "auto"]} />
              <Tooltip contentStyle={{ border: "1px solid #dbe9ed", borderRadius: 10, fontSize: 12 }} labelFormatter={(value) => `第 ${value} 分钟`} />
              <Line type="monotone" dataKey="normalSpeedMps" name="正常预测 m/s" stroke="#0f7f8a" strokeWidth={2.1} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="faultSpeedMps" name="故障后 m/s" stroke="#d97706" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="h-full rounded-xl bg-mist-100" />}
      </div>
      <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
        <Wrench className="mt-1 h-4 w-4 shrink-0" />
        <span><strong>降级策略：</strong>{result.fault.recommendation}</span>
      </div>
    </div>
  );
}

function TwinFatigueResult({ result }: { result: TwinSimulationResult }) {
  return (
    <div>
      <SimulationResultHeader icon={Activity} title="疲劳损耗估算" result={result} risk={result.fatigue.overallHealth < 45 ? "high" : result.fatigue.overallHealth < 72 ? "medium" : "low"} />
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <TwinPredictionMetric label="综合健康度" value={`${result.fatigue.overallHealth}`} unit="%" />
        <TwinPredictionMetric label="建议检查间隔" value={`${result.fatigue.nextInspectionHours}`} unit="h" />
        <TwinPredictionMetric label="最高风险部件" value={result.fatigue.highestRiskComponent} unit="" compact />
      </div>
      <div className="mt-6 divide-y divide-mist-200 border-y border-mist-200">
        {result.fatigue.components.map((component) => (
          <div key={component.id} className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <strong className="text-sm font-semibold text-ink-900">{component.label}</strong>
                <TwinRiskBadge risk={component.risk} />
              </div>
              <span className="text-xs font-semibold tabular-nums text-ink-500">损耗 {component.damagePercent}% · 剩余约 {component.remainingLifeHours} h</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-mist-100">
              <div
                className={`h-full rounded-full ${component.risk === "high" ? "bg-red-500" : component.risk === "medium" ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(100, Math.max(1, component.damagePercent))}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] font-semibold text-ink-500">主要载荷：{component.driver}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimulationResultHeader({
  icon: Icon,
  title,
  result,
  risk,
}: {
  icon: typeof Route;
  title: string;
  result: TwinSimulationResult;
  risk: TwinRiskLevel;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-harbor-600" />
          <h3 className="text-base font-semibold text-ink-900">{title}</h3>
          <TwinRiskBadge risk={risk} />
        </div>
        <p className="mt-1 text-[11px] font-semibold text-ink-500">模型 {result.modelVersion} · {new Date(result.generatedAt).toLocaleTimeString("zh-CN")}</p>
      </div>
      <span className="inline-flex items-center gap-2 rounded-lg bg-harbor-50 px-3 py-2 text-xs font-semibold text-harbor-700">
        <Gauge className="h-3.5 w-3.5" />置信度 {result.confidence}%
      </span>
    </div>
  );
}

function TwinPredictionMetric({ label, value, unit, compact = false }: { label: string; value: string; unit: string; compact?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-mist-200 bg-mist-50 px-4 py-3">
      <span className="text-[11px] font-semibold text-ink-500">{label}</span>
      <div className="mt-1 flex min-w-0 items-baseline gap-1">
        <strong className={`${compact ? "truncate text-base" : "text-2xl"} min-w-0 font-semibold tracking-normal text-ink-900`}>{value}</strong>
        {unit ? <span className="shrink-0 text-xs font-semibold text-ink-500">{unit}</span> : null}
      </div>
    </div>
  );
}

function TwinRiskBadge({ risk }: { risk: TwinRiskLevel }) {
  const config = risk === "high"
    ? { label: "高风险", className: "border-red-200 bg-red-50 text-red-700" }
    : risk === "medium"
      ? { label: "需关注", className: "border-amber-200 bg-amber-50 text-amber-700" }
      : { label: "低风险", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${config.className}`}>{config.label}</span>;
}

function TwinSimulationProvenance({ result }: { result: TwinSimulationResult }) {
  const sourceTone = {
    measured: "bg-emerald-500",
    snapshot: "bg-sky-500",
    assumed: "bg-amber-500",
  } as const;
  const sourceLabel = { measured: "实测", snapshot: "快照", assumed: "假设" } as const;
  return (
    <div className="mt-6 border-t border-mist-200 pt-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        <Database className="h-4 w-4 text-harbor-600" />
        模型依据
      </div>
      <div className="mt-3 grid gap-x-6 gap-y-3 md:grid-cols-2">
        {result.sources.map((source) => (
          <div key={source.label} className="flex items-start gap-3">
            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${sourceTone[source.kind]}`} />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink-900">{source.label} <span className="ml-1 text-ink-500">{sourceLabel[source.kind]}</span></p>
              <p className="mt-0.5 text-[11px] font-semibold leading-5 text-ink-500">{source.detail}</p>
            </div>
          </div>
        ))}
      </div>
      <details className="mt-4 rounded-xl bg-mist-50 px-4 py-3 text-xs text-ink-500">
        <summary className="cursor-pointer font-semibold text-ink-700">查看模型假设与限制</summary>
        <ul className="mt-3 space-y-2 leading-5">
          {result.assumptions.map((assumption) => <li key={assumption}>• {assumption}</li>)}
        </ul>
      </details>
    </div>
  );
}

function healthCardClass(status: DeviceStatus) {
  return status === "online"
    ? "border-app-line bg-white"
    : "border-red-200 bg-red-50/80";
}

function collectHealthWarnings(snapshot: PlatformSnapshot) {
  const issues: string[] = [];
  const deviceLabels: Array<[string, DeviceStatus]> = [
    ["主控开发板", snapshot.vessel.esp32],
    ["飞控模块", snapshot.vessel.pixhawk],
    ["通信模块", snapshot.vessel.communication],
    ["传感器状态", snapshot.vessel.sensor],
  ];

  snapshot.batteries.forEach((battery) => {
    if (battery.status !== "online") {
      issues.push(`电池 ${battery.id} 状态异常：${deviceStatusText(battery.status)}`);
    }

    if (battery.percentage <= 30) {
      issues.push(`电池 ${battery.id} 电量偏低：${battery.percentage}%`);
    }
  });

  deviceLabels.forEach(([label, status]) => {
    if (status !== "online") {
      issues.push(`${label} 状态异常：${deviceStatusText(status)}`);
    }
  });

  return issues;
}

function deviceStatusText(status: DeviceStatus) {
  if (status === "warning") return "预警";
  if (status === "offline") return "离线";
  return "在线";
}

function PageFrame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={`mx-auto space-y-6 ${wide ? "max-w-[1380px]" : "max-w-[1160px]"}`}>{children}</div>;
}

function PageHeader({ title }: { kicker?: string; title: string; description: string }) {
  return (
    <header className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-normal text-ink-900 md:text-3xl">{title}</h1>
    </header>
  );
}

function logLevelLabel(level: SystemLog["level"]) {
  if (level === "success") return "成功";
  if (level === "warning") return "预警";
  if (level === "error") return "异常";
  return "信息";
}

function MetricCard({
  label,
  value,
  suffix = "",
  decimals = 0,
  tone = "default",
}: {
  label: string;
  value?: number | null;
  suffix?: string;
  decimals?: number;
  detail?: string;
  icon?: typeof Gauge;
  tone?: "default" | "good" | "watch";
}) {
  const toneClass = tone === "good"
    ? "border-harbor-600/25 bg-harbor-100/70"
    : tone === "watch"
      ? "border-sand-500/25 bg-sand-100/80"
      : "border-app-line bg-white";

  return (
    <article className={`rounded-3xl border p-7 shadow-soft transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_60px_rgba(23,32,51,0.11)] ${toneClass}`}>
      <div className="flex items-center">
        <span className="text-sm font-semibold text-ink-500">{label}</span>
      </div>
      <strong className="mt-7 block text-4xl font-semibold tracking-normal text-ink-900">
        {typeof value === "number" && Number.isFinite(value) ? (
          <AnimatedNumber value={value} decimals={decimals} suffix={suffix ? ` ${suffix}` : ""} />
        ) : (
          "--"
        )}
      </strong>
    </article>
  );
}

function InfoPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-app-line bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold text-ink-500">{label}</p>
      <strong className="mt-3 block text-lg font-semibold text-ink-900">{value}</strong>
    </div>
  );
}

function TextList({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
      <ul className="mt-4 space-y-3 text-sm leading-7 text-ink-500">
        {items.map((item) => (
          <li key={item} className="flex gap-3">
            <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-harbor-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusBadge({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "good" | "warn" }) {
  const className = tone === "good"
    ? "border-sage-500/20 bg-sage-100 text-sage-500"
    : tone === "warn"
      ? "border-sand-500/20 bg-sand-100 text-sand-500"
      : "border-app-line bg-white text-ink-500";
  return <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1.5 text-xs font-semibold ${className}`}>{text}</span>;
}

function ActionButton({ icon: Icon, label, onClick, disabled, primary = false }: { icon: typeof Play; label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl border px-5 py-3 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-50 ${
        primary
          ? "border-harbor-600 bg-harbor-600 text-white hover:bg-harbor-500"
          : "border-app-line bg-white text-ink-700 hover:border-harbor-500/40 hover:text-harbor-600"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return <div className="grid h-full min-h-[240px] place-items-center rounded-2xl bg-app-subtle text-sm font-semibold text-ink-500">{text}</div>;
}

function useVisualReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return ready;
}
