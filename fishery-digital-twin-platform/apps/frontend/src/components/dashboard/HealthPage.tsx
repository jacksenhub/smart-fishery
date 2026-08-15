"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { Battery, CheckCircle2 } from "lucide-react";
import type { DeviceStatus } from "@fishery/shared";
import { usePlatformData } from "@/hooks/usePlatformData";
import { platformStore } from "@/lib/platformStore";
import { StatusPill } from "@/components/ui/StatusPill";
import { PageFrame, useVisualReady } from "@/components/dashboard/DashboardPrimitives";
import { DeviceIcon } from "@/components/icons/MaritimeIcons";

export function HealthPage() {
  const { snapshot, connected, updatedAt } = usePlatformData();
  const visualReady = useVisualReady();
  const [checking, setChecking] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const devices: Array<{ label: string; status: DeviceStatus }> = [
    { label: "主控开发板", status: snapshot.vessel.esp32 },
    { label: "飞控模块", status: snapshot.vessel.pixhawk },
    { label: "通信模块", status: snapshot.vessel.communication },
    { label: "环境传感器", status: snapshot.vessel.sensor },
  ];
  const averageBattery = Math.round(snapshot.batteries.reduce((sum, battery) => sum + battery.percentage, 0) / snapshot.batteries.length);
  const warningBatteries = snapshot.batteries.filter((battery) => battery.status !== "online" || battery.percentage <= 30);
  const deviceWarnings = devices.filter((device) => device.status !== "online");
  const activeWarnings = warningBatteries.length + deviceWarnings.length;
  const severeFaults = [...snapshot.batteries.map((battery) => battery.status), ...devices.map((device) => device.status)].filter((status) => status === "offline").length;
  const onlineDevices = devices.filter((device) => device.status === "online").length;
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - activeWarnings * 8 - severeFaults * 12 - Math.max(0, 80 - averageBattery) * 0.7)));
  const healthLabel = healthScore >= 85 ? "良好" : healthScore >= 70 ? "需关注" : "预警";
  const healthTrend = useMemo(() => Array.from({ length: 12 }, (_, index) => ({
    time: `${String(index * 2).padStart(2, "0")}:00`,
    score: Math.max(0, Math.min(100, healthScore - Math.round(Math.sin(index * 0.72) * 2.2) - (11 - index) * 0.18)),
  })), [healthScore]);

  async function handleHealthCheck() {
    setChecking(true);
    try {
      await Promise.all([platformStore.refreshSnapshot(), platformStore.refreshFeedback()]);
      setChecking(false);
      setLastCheckedAt(new Date());
    } catch {
      setChecking(false);
      setLastCheckedAt(new Date());
    }
  }

  return (
    <PageFrame wide>
      <section className="rounded-[26px] border border-app-line bg-[linear-gradient(120deg,#ffffff_0%,#edf7f5_100%)] px-6 py-5 shadow-soft">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-ink-900 md:text-3xl">船舶健康管理</h1>
              <span className="text-sm font-semibold text-ink-500">01号无人船 · {snapshot.vessel.mission || "待命"}</span>
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${snapshot.vessel.communication === "online" ? "bg-sage-100 text-sage-500" : "bg-red-50 text-red-600"}`}>
                <span className={`h-2 w-2 rounded-full ${snapshot.vessel.communication === "online" ? "bg-sage-500" : "bg-red-500"}`} />
                {snapshot.vessel.communication === "online" ? "通信正常" : "通信异常"}
              </span>
            </div>
            <p className="mt-3 text-sm text-ink-500">最近检测 {lastCheckedAt ? lastCheckedAt.toLocaleTimeString("zh-CN", { hour12: false }) : "尚未执行"}</p>
          </div>
          <button
            type="button"
            onClick={handleHealthCheck}
            disabled={checking}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-harbor-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-harbor-500 disabled:cursor-wait disabled:opacity-60"
          >
            <span className="grid h-7 w-7 place-items-center rounded-full bg-white/14">
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.8} />
            </span>
            {checking ? "检查中" : "立即健康检查"}
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-[26px] border border-app-line bg-white shadow-soft">
        <div className="grid lg:grid-cols-[330px_minmax(0,1fr)]">
          <div className="grid place-items-center border-b border-app-line bg-harbor-50/70 px-8 py-10 text-center lg:border-b-0 lg:border-r">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-ink-500">综合健康状态</p>
              <strong className={`mt-4 block text-6xl font-semibold ${healthScore >= 85 ? "text-sage-500" : healthScore >= 70 ? "text-sand-500" : "text-red-600"}`}>{healthScore}</strong>
              <p className="mt-2 text-lg font-semibold text-ink-900">{healthLabel}</p>
              <p className="mt-4 text-sm text-ink-500">{connected && severeFaults === 0 ? "系统当前可继续运行" : "请先恢复离线设备或后端连接"}</p>
            </div>
          </div>
          <div className="p-6 md:p-8">
            <h2 className="text-lg font-semibold text-ink-900">设备统计</h2>
            <div className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
              <HealthStat label="在线设备" value={`${onlineDevices}/${devices.length}`} />
              <HealthStat label="电池平均电量" value={`${averageBattery}%`} />
              <HealthStat label="当前预警" value={`${activeWarnings} 项`} tone={activeWarnings > 0 ? "warning" : "normal"} />
              <HealthStat label="严重故障" value={`${severeFaults} 项`} tone={severeFaults > 0 ? "danger" : "normal"} />
            </div>
            <div className="mt-8 rounded-2xl bg-app-subtle px-5 py-4 text-sm text-ink-700">
              <span className="font-semibold text-harbor-600">建议：</span>
              {warningBatteries.length > 0 ? `返航前检查电池 ${warningBatteries.map((battery) => battery.id).join("、")}` : "设备状态稳定，按计划执行例行检查"}
            </div>
          </div>
        </div>
      </section>

      <section className="grid overflow-hidden rounded-[26px] border border-app-line bg-white shadow-soft xl:grid-cols-[1.1fr_.9fr]">
        <div className="border-b border-app-line p-6 md:p-8 xl:border-b-0 xl:border-r">
          <h2 className="text-lg font-semibold text-ink-900">电源系统</h2>
          <div className="mt-6 divide-y divide-app-line">
            {snapshot.batteries.map((battery) => {
              const abnormal = battery.status !== "online";
              return (
                <div key={battery.id} className="py-5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <span className={`grid h-9 w-9 place-items-center rounded-full ${abnormal ? "bg-red-50 text-red-600" : "bg-harbor-50 text-harbor-600"}`}>
                        <Battery className="h-4 w-4" strokeWidth={1.8} />
                      </span>
                      <strong className="text-sm text-ink-900">电池 {battery.id}</strong>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="font-semibold text-ink-900">{battery.percentage}%</span>
                      <span className="text-ink-500">{battery.voltage.toFixed(1)} V</span>
                      <StatusPill status={battery.status} />
                    </div>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-app-subtle">
                    <div className={`h-full rounded-full ${abnormal ? "bg-red-500" : "bg-harbor-500"}`} style={{ width: `${battery.percentage}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="p-6 md:p-8">
          <h2 className="text-lg font-semibold text-ink-900">核心设备状态</h2>
          <div className="mt-6 divide-y divide-app-line">
            {devices.map((device) => (
              <div key={device.label} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-app-subtle text-ink-700"><DeviceIcon className="h-4 w-4" /></span>
                  <strong className="text-sm text-ink-900">{device.label}</strong>
                </div>
                <StatusPill status={device.status} />
              </div>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 rounded-2xl bg-app-subtle p-4 text-sm">
            <div><span className="text-ink-500">当前航点</span><strong className="mt-1 block text-ink-900">{snapshot.navigation.targetWaypoint.label || "--"}</strong></div>
            <div>
              <span className="text-ink-500">数据状态</span>
              <strong className={`mt-1 block ${connected ? "text-sage-500" : "text-red-600"}`}>
                {connected ? `${snapshot.dataMode === "live" ? "真实数据" : snapshot.dataMode === "mixed" ? "混合数据" : snapshot.dataMode === "demo" ? "演示数据" : "回退数据"} · ${updatedAt?.toLocaleTimeString("zh-CN", { hour12: false }) ?? "--"}` : "后端连接已断开"}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="grid overflow-hidden rounded-[26px] border border-app-line bg-white shadow-soft xl:grid-cols-[.82fr_1.18fr]">
        <div className="border-b border-app-line p-6 md:p-8 xl:border-b-0 xl:border-r">
          <h2 className="text-lg font-semibold text-ink-900">最近告警</h2>
          {activeWarnings > 0 ? (
            <div className="mt-5 space-y-4">
              {warningBatteries.map((battery) => (
                <div key={battery.id} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sand-500" />
                  <div><strong className="text-ink-900">电池 {battery.id} 状态需关注</strong><p className="mt-1 text-ink-500">当前电量 {battery.percentage}% · 电压 {battery.voltage.toFixed(1)} V</p></div>
                </div>
              ))}
              {deviceWarnings.map((device) => (
                <div key={device.label} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                  <div><strong className="text-ink-900">{device.label}状态异常</strong><p className="mt-1 text-ink-500">请检查设备连接与供电</p></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-8 rounded-2xl bg-sage-100 px-5 py-6 text-sm font-semibold text-sage-500">暂无活动告警</div>
          )}
        </div>
        <div className="p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-ink-900">状态评分参考</h2>
            <span className="text-xs font-semibold text-ink-500">基于当前快照推算，非历史实测</span>
          </div>
          <div className="mt-5 h-[220px]">
            {!visualReady ? (
              <div className="h-full rounded-2xl bg-app-subtle" />
            ) : (
              <ResponsiveContainer width="100%" height="100%" minWidth={260} minHeight={180}>
                <AreaChart data={healthTrend} margin={{ top: 10, right: 4, left: -28, bottom: 0 }}>
                  <defs><linearGradient id="health-score-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14949a" stopOpacity={0.28} /><stop offset="100%" stopColor="#14949a" stopOpacity={0.02} /></linearGradient></defs>
                  <CartesianGrid stroke="#d9e4e7" vertical={false} />
                  <XAxis dataKey="time" stroke="#6a7f87" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis domain={[60, 100]} stroke="#6a7f87" fontSize={10} tickLine={false} axisLine={false} />
                  <Area type="monotone" dataKey="score" stroke="#0b7f86" strokeWidth={2.5} fill="url(#health-score-fill)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>
    </PageFrame>
  );
}

function HealthStat({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "warning" | "danger" }) {
  const valueClass = tone === "danger" ? "text-red-600" : tone === "warning" ? "text-sand-500" : "text-ink-900";
  return (
    <div>
      <p className="text-xs font-semibold text-ink-500">{label}</p>
      <strong className={`mt-2 block text-2xl font-semibold ${valueClass}`}>{value}</strong>
    </div>
  );
}
