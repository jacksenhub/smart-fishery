"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePlatformData } from "@/hooks/usePlatformData";
import {
  HullWireframeIcon,
  NavigationJournalIcon,
  PropellerIcon,
  SurfaceProbeIcon,
  TimeIcon,
  VesselStatusIcon,
  WaypointPathIcon,
} from "@/components/icons/MaritimeIcons";

const navItems = [
  { href: "/dashboard/twin", label: "三维孪生", icon: HullWireframeIcon },
  { href: "/dashboard/water", label: "环境监测", icon: SurfaceProbeIcon },
  { href: "/dashboard/servos", label: "功能操控", icon: PropellerIcon },
  { href: "/dashboard/navigation", label: "智能航行", icon: WaypointPathIcon },
  { href: "/dashboard/health", label: "船舶健康", icon: VesselStatusIcon },
  { href: "/dashboard/logs", label: "日志中心", icon: NavigationJournalIcon },
];

export function PlatformShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const currentModule = getCurrentModule(pathname);
  const [headerVisible, setHeaderVisible] = useState(true);
  const lastScrollY = useRef(0);
  const { snapshot, updatedAt, loading, connected } = usePlatformData(5000);
  const displayTime = updatedAt
    ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(updatedAt)
    : "--:--:--";

  useEffect(() => {
    setHeaderVisible(true);
    lastScrollY.current = window.scrollY;
  }, [pathname]);

  useEffect(() => {
    let ticking = false;

    function updateHeaderVisibility() {
      const currentScrollY = window.scrollY;
      const delta = currentScrollY - lastScrollY.current;

      if (currentScrollY < 72) {
        setHeaderVisible(true);
      } else if (delta > 14) {
        setHeaderVisible(false);
      } else if (delta < -8) {
        setHeaderVisible(true);
      }

      lastScrollY.current = currentScrollY;
      ticking = false;
    }

    function handleScroll() {
      if (!ticking) {
        window.requestAnimationFrame(updateHeaderVisibility);
        ticking = true;
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <main className="min-h-screen bg-app-bg text-ink-900">
      <div className="mx-auto grid min-h-screen w-full max-w-[1680px] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden border-r border-app-line bg-[linear-gradient(180deg,#ffffff_0%,#f5faf9_100%)] px-5 py-6 lg:block">
          <Link
            href="/"
            className="mb-9 grid h-12 w-12 place-items-center overflow-hidden rounded-2xl border border-app-line bg-white p-1.5 shadow-sm transition hover:border-harbor-500/40 hover:bg-harbor-50"
            aria-label="返回首页 3D 模型"
            title="返回首页"
          >
            <Image src="/brand-ship-logo.png" alt="返回首页" width={40} height={40} className="h-full w-full object-contain" />
          </Link>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex h-14 items-center gap-3.5 rounded-lg px-4 text-sm font-semibold transition-colors ${
                    active
                      ? "bg-harbor-100 text-harbor-600 ring-1 ring-inset ring-harbor-500/20"
                      : "text-slate-500 hover:bg-app-subtle hover:text-slate-800"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center text-current">
                    <item.icon className="h-5 w-5" />
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <section className="min-w-0">
          <header className={`sticky top-0 z-20 border-b border-app-line bg-white/94 px-5 py-3 backdrop-blur transition-all duration-300 md:px-8 ${
            headerVisible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0"
          }`}>
            <div className="flex min-h-[64px] flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="hidden h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl border border-app-line bg-white p-1.5 md:grid">
                  <Image src="/brand-ship-logo.png" alt="" width={40} height={40} className="h-full w-full object-contain" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-base font-semibold tracking-normal text-ink-900 md:text-lg">智慧渔业船监控平台</h1>
                    <span className="text-sm text-ink-500">/</span>
                    <span className="text-sm font-semibold text-harbor-600">{currentModule}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <TopStatus icon={TimeIcon} label="数据时间" value={loading ? "同步中" : connected ? displayTime : "后端断开"} />
                <OnlineStatus online={connected && snapshot.vessel.online} />
              </div>
            </div>

            <nav className="mt-4 flex gap-2 overflow-auto pb-1 lg:hidden">
              {navItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex h-12 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${
                      active ? "border-harbor-500 bg-harbor-100 text-harbor-600" : "border-app-line bg-white text-ink-500"
                    }`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="grid h-7 w-7 place-items-center text-current">
                      <item.icon className="h-5 w-5" />
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </header>

          <div className="px-5 py-8 md:px-8 lg:py-10">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}

function getCurrentModule(pathname: string) {
  const item = navItems.find((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`));
  return item?.label || "数字孪生";
}

function TopStatus({ icon: Icon, label, value }: { icon?: typeof TimeIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 border-l border-app-line pl-4 first:border-l-0 first:pl-0">
      {Icon ? <Icon className="h-4 w-4 text-ink-500" /> : null}
      <span className="text-xs font-semibold text-ink-500">{label}</span>
      <strong className="text-sm font-semibold text-ink-900">{value}</strong>
    </div>
  );
}

function OnlineStatus({ online }: { online: boolean }) {
  return (
    <div className="flex items-center gap-2 border-l border-app-line pl-4">
      <span className={`h-2 w-2 rounded-full ${online ? "bg-sage-500" : "bg-red-500"}`} />
      <strong className={`text-sm font-semibold ${online ? "text-sage-500" : "text-red-600"}`}>
        {online ? "在线" : "离线"}
      </strong>
    </div>
  );
}
