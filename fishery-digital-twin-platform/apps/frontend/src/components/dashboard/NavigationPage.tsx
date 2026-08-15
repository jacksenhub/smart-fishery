"use client";

import dynamic from "next/dynamic";
import { usePlatformData } from "@/hooks/usePlatformData";
import { PageFrame, PageHeader } from "@/components/dashboard/DashboardPrimitives";
import { RouteIcon } from "@/components/icons/MaritimeIcons";

const NavigationMap = dynamic(() => import("@/components/map/NavigationMap").then((module) => module.NavigationMap), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-ink-500">地图加载中</div>,
});

function routeLengthKm(route: Array<{ lat: number; lng: number }>) {
  if (route.length < 2) return 0;
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  let distance = 0;

  for (let index = 0; index < route.length; index += 1) {
    const start = route[index];
    const end = route[(index + 1) % route.length];
    const deltaLat = toRadians(end.lat - start.lat);
    const deltaLng = toRadians(end.lng - start.lng);
    const startLat = toRadians(start.lat);
    const endLat = toRadians(end.lat);
    const haversine = Math.sin(deltaLat / 2) ** 2
      + Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2;
    distance += 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
  }

  return distance;
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

export function NavigationPage() {
  const { snapshot } = usePlatformData();
  const nav = snapshot.navigation;
  const gps = nav.gps;
  const liveGps = nav.source === "gps";
  const gpsWaiting = !liveGps && gps?.online;
  const totalRouteDistance = routeLengthKm(nav.route);
  const routeProgress = totalRouteDistance > 0
    ? Math.min(100, Math.max(0, Math.round((1 - nav.remainingDistance / totalRouteDistance) * 100)))
    : 0;
  const remainingDistance = nav.remainingDistance < 1
    ? `${Math.round(nav.remainingDistance * 1000)} m`
    : `${nav.remainingDistance.toFixed(2)} km`;
  const statusLabel = liveGps ? "GPS 实时定位" : gpsWaiting ? "GPS 等待定位" : "模拟航线";
  const statusClass = liveGps
    ? "bg-sage-100 text-sage-500"
    : gpsWaiting
      ? "bg-sand-100 text-sand-500"
      : "bg-app-subtle text-ink-500";
  const statusDotClass = liveGps ? "bg-sage-500" : gpsWaiting ? "bg-sand-500" : "bg-ink-400";
  return (
    <PageFrame wide>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader kicker="Navigation" title="智能航行" description="以自主巡航为核心，集中展示航迹、任务进度与实时航行参数。" />
        <span className={`inline-flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${statusClass}`}>
          <span className={`h-2 w-2 rounded-full ${statusDotClass}`} />{statusLabel}
        </span>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="h-[620px] overflow-hidden rounded-[28px] border border-app-line bg-white shadow-soft">
          <NavigationMap navigation={nav} />
        </div>
        <aside className="flex max-h-[620px] flex-col overflow-y-auto rounded-[28px] border border-app-line bg-white p-6 shadow-soft">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-harbor-100 text-harbor-600"><RouteIcon className="h-5 w-5" /></span>
            <div><p className="text-xs font-semibold text-ink-500">当前任务</p><strong className="mt-1 block text-lg text-ink-900">{snapshot.vessel.mission || "自主水域巡检"}</strong></div>
          </div>

          {liveGps ? (
            <div className="mt-7 rounded-2xl bg-sage-100 p-4 text-sm text-sage-500">
              <strong className="block">实时坐标已接入</strong>
              <span className="mt-1 block text-xs">WGS-84坐标直接显示在OpenStreetMap上</span>
            </div>
          ) : (
            <div className="mt-7">
              <div className="flex items-center justify-between text-xs font-semibold text-ink-500"><span>巡航进度</span><span>{routeProgress}%</span></div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-app-subtle"><div className="h-full rounded-full bg-harbor-500" style={{ width: `${routeProgress}%` }} /></div>
            </div>
          )}

          <div className="mt-7 grid grid-cols-2 gap-x-5 gap-y-6 border-y border-app-line py-6">
            <HealthStat label="当前速度" value={`${nav.speed.toFixed(2)} m/s`} />
            <HealthStat label="当前航向" value={`${nav.heading}°`} />
            <HealthStat
              label={liveGps ? "卫星数量" : "剩余航程"}
              value={liveGps ? `${gps?.satellites ?? "--"}` : remainingDistance}
            />
            <HealthStat
              label={liveGps ? "定位精度 HDOP" : "预计到达"}
              value={liveGps ? `${gps?.hdop ?? "--"}` : `${nav.etaMinutes} min`}
              tone={liveGps && gps?.hdop !== null && gps?.hdop !== undefined && gps.hdop > 3 ? "warning" : "normal"}
            />
          </div>

          {nav.route.length > 0 && (
            <div className="mt-6">
            <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-ink-900">自主巡航航点</h2><RouteIcon className="h-4 w-4 text-harbor-600" /></div>
            <div className="mt-4 space-y-4">
              {nav.route.slice(0, 4).map((point, index) => (
                <div key={`${point.lat}-${point.lng}`} className="flex items-center gap-3 text-sm">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${point.label === nav.targetWaypoint.label ? "bg-harbor-600 text-white" : "bg-app-subtle text-ink-500"}`}>{index + 1}</span>
                  <div className="min-w-0"><strong className="block truncate text-ink-900">{point.label}</strong><span className="mt-0.5 block truncate text-xs text-ink-500">{point.lat.toFixed(4)}, {point.lng.toFixed(4)}</span></div>
                </div>
              ))}
            </div>
          </div>
          )}

          {gps && (
            <div className="mt-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink-900">GPS定位信息</h2>
                <span className="text-xs font-semibold text-ink-500">{gps.coordinate_system}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-app-subtle p-3"><span className="text-ink-500">设备</span><strong className="mt-1 block text-ink-900">{gps.device_id}</strong></div>
                <div className="rounded-xl bg-app-subtle p-3"><span className="text-ink-500">串口</span><strong className="mt-1 block text-ink-900">{gps.serial_online ? "正常" : "离线"}</strong></div>
                <div className="rounded-xl bg-app-subtle p-3"><span className="text-ink-500">定位</span><strong className="mt-1 block text-ink-900">{gps.valid ? "有效" : "等待中"}</strong></div>
                <div className="rounded-xl bg-app-subtle p-3"><span className="text-ink-500">字符数</span><strong className="mt-1 block text-ink-900">{gps.chars_processed}</strong></div>
              </div>
            </div>
          )}

          <div className="mt-6 rounded-2xl bg-app-subtle p-4 text-xs leading-6 text-ink-500">
            <span className="font-semibold text-ink-700">当前位置</span><br />{nav.position.lat.toFixed(5)}, {nav.position.lng.toFixed(5)}
          </div>
        </aside>
      </div>
    </PageFrame>
  );
}
