"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, CheckCircle2, Flag, Gauge, LoaderCircle, MapPin, Maximize2, Play, RotateCcw, Route, ShieldAlert, Thermometer, Waves, Wrench } from "lucide-react";
import type { TwinFaultType, TwinRiskLevel, TwinSimulationInput, TwinSimulationResult, TwinWaveLevel } from "@fishery/shared";
import { runTwinPrediction } from "@/lib/api";
import { usePlatformData } from "@/hooks/usePlatformData";
import { StatusPill } from "@/components/ui/StatusPill";
import { PageFrame, useVisualReady } from "@/components/dashboard/DashboardPrimitives";
import { InsightIcon, JournalIcon, RudderIcon, WaterIcon } from "@/components/icons/MaritimeIcons";

const BoatTwinScene = dynamic(() => import("@/components/three/BoatTwinScene").then((module) => module.BoatTwinScene), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-ink-500">模型加载中</div>,
});



type TwinSimulationMode = "route" | "fault" | "fatigue";


export function TwinPage() {
  const { snapshot } = usePlatformData(8000);
  const latest = snapshot.water.at(-1);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [sceneResetNonce, setSceneResetNonce] = useState(0);
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
  const baseMissionProgress = Math.min(96, Math.max(18, Math.round((1 - snapshot.navigation.remainingDistance / 4) * 100)));
  const missionProgress = Math.min(100, Math.max(0, baseMissionProgress));
  const averageBattery = Math.round(snapshot.batteries.reduce((sum, item) => sum + item.percentage, 0) / snapshot.batteries.length);
  const runtimeHours = Math.max(0.5, averageBattery / 18).toFixed(1);
  const navigationTrend = useMemo(() => Array.from({ length: 20 }, (_, index) => ({
    point: index + 1,
    speed: Number(Math.max(0, snapshot.navigation.speed + Math.sin(index * 0.52) * 0.13 + ((index % 4) - 1.5) * 0.018).toFixed(2)),
    battery: Number(Math.max(0, averageBattery - (19 - index) * 0.11).toFixed(1)),
  })), [averageBattery, snapshot.navigation.speed]);
  const gpsLive = snapshot.navigation.source === "gps" &&
    Boolean(snapshot.navigation.gps?.online && snapshot.navigation.gps.valid);

  function resetSceneView() {
    setSceneResetNonce((value) => value + 1);
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
      <section className="rounded-[24px] border border-mist-200 bg-[linear-gradient(120deg,#ffffff_0%,#f0f8f7_100%)] px-6 py-5 shadow-[0_18px_55px_rgba(42,85,102,0.07)]">
        <h1 className="text-2xl font-semibold tracking-normal text-ink-900 md:text-3xl">数字孪生中心</h1>
      </section>

      <div className="space-y-7">
        <section ref={sceneRef} className="overflow-hidden rounded-[26px] border border-mist-200 bg-white shadow-[0_24px_70px_rgba(50,91,109,0.09)]">
          <div className="relative h-[560px] bg-[linear-gradient(180deg,#edfaff_0%,#dff3f8_55%,#d5eef4_100%)] md:h-[660px] xl:h-[720px]">
            <BoatTwinScene
              key={sceneResetNonce}
              viewMode="top"
              autoRotate={false}
              float={false}
              showOcean
              liveOcean={liveOcean}
              showGrid={false}
              workSimulation
              showWorkEquipment
              showAquaculture
              vesselScale={1.35}
              simulationPreview={simulationResult && simulationMode === "route" ? { active: true, risk: simulationResult.route.risk } : undefined}
            />

            <div className="absolute left-5 top-5 max-w-[calc(100%-2.5rem)] rounded-2xl border border-white/85 bg-white/86 px-4 py-3 text-xs font-semibold text-ink-500 shadow-[0_12px_35px_rgba(42,91,109,0.11)] backdrop-blur-md">
              <div className="flex items-center gap-2 text-ink-900">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-500" />
                船舶作业模拟演示 · 俯视
              </div>
            </div>

            {simulationResult && simulationMode === "route" ? (
              <div className="absolute left-5 top-28 max-w-[calc(100%-2.5rem)] rounded-xl border border-amber-200 bg-amber-50/92 px-3 py-2 text-[11px] font-semibold text-amber-800 shadow-[0_10px_28px_rgba(120,83,24,0.1)] backdrop-blur-md">
                <span className="inline-flex items-center gap-2"><InsightIcon className="h-3.5 w-3.5" />仿真预测图层</span>
                <span className="ml-2 text-amber-700">不代表设备实际位置</span>
              </div>
            ) : null}

            <div className="pointer-events-none absolute bottom-5 left-1/2 hidden -translate-x-1/2 rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-ink-500 shadow-[0_10px_30px_rgba(42,91,109,0.1)] backdrop-blur-md lg:block">
              拖拽平移 · 滚轮缩放
            </div>

            <div className="absolute bottom-5 left-5 rounded-2xl border border-white/80 bg-white/82 px-4 py-3 text-xs font-semibold text-ink-500 shadow-[0_12px_35px_rgba(42,91,109,0.11)] backdrop-blur-md">
              <div className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5 text-harbor-600" />
                {snapshot.navigation.position.lat.toFixed(5)}, {snapshot.navigation.position.lng.toFixed(5)}
              </div>
              <div className="mt-2 h-1 w-24 rounded-full bg-harbor-100">
                <div className={`h-full rounded-full ${gpsLive ? "w-full bg-emerald-500" : "w-1/3 bg-amber-400"}`} />
              </div>
              <p className="mt-1.5 text-[10px] text-ink-400">
                {gpsLive ? `GPS航向 ${snapshot.navigation.heading.toFixed(0)}°` : "当前为模拟位置，未驱动船体"}
              </p>
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
            <TwinSceneToolbar
              onResetView={resetSceneView}
              liveOcean={liveOcean}
              onToggleLiveOcean={() => setLiveOcean((value) => !value)}
            />
          </div>
        </section>

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
              <StatusPill status={snapshot.vessel.online ? "online" : "offline"} />
            </div>
            <div className="mt-6 space-y-4">
              <TwinKeyValue label="当前任务" value={snapshot.vessel.mission || "未下发任务"} />
              <TwinKeyValue label="运行状态" value={snapshot.vessel.online ? "运行中" : "离线"} />
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
                label={gpsLive ? "GPS实时航速" : "模拟航速"}
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

function TwinSceneToolbar({
  onResetView,
  liveOcean,
  onToggleLiveOcean,
}: {
  onResetView: () => void;
  liveOcean: boolean;
  onToggleLiveOcean: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex h-11 items-center rounded-xl border border-harbor-200 bg-harbor-50 px-4 text-xs font-semibold text-harbor-700">
        俯视模式
      </span>
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
        title={liveOcean ? "动态水面：开启" : "动态水面：关闭"}
        aria-pressed={liveOcean}
      >
        <WaterIcon className="h-4 w-4" />
      </button>
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
            <RudderIcon className="h-4 w-4 text-harbor-600" />
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
            <InsightIcon className="mx-auto h-9 w-9 text-harbor-500" />
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
          <JournalIcon className="h-4 w-4 text-harbor-600" />
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
