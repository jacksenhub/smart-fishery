"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { VesselIcon } from "@/components/icons/MaritimeIcons";

const BoatTwinScene = dynamic(() => import("@/components/three/BoatTwinScene").then((module) => module.BoatTwinScene), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-ink-500">模型加载中</div>,
});

export function LandingExperience() {
  const router = useRouter();
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    router.prefetch("/dashboard");
  }, [router]);

  function handleEnterSystem() {
    if (entering) return;

    setEntering(true);
    window.setTimeout(() => {
      router.push("/dashboard");
    }, 900);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_50%_46%,rgba(24,151,163,.14),transparent_34%),linear-gradient(135deg,#f1fbff_0%,#e8f7fc_48%,#d9eef6_100%)] text-ink-900">
      <div className="pointer-events-auto absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 px-6 py-5 md:px-10">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-[22px] border border-white/80 bg-white/70 p-1.5 pr-4 text-ink-900 shadow-sm backdrop-blur-md transition hover:border-harbor-200 hover:bg-harbor-50"
          aria-label="耕海一号"
        >
          <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-2xl border border-app-line bg-white p-1.5">
            <Image src="/brand-ship-logo-small.png" alt="" width={40} height={40} className="h-full w-full object-contain" />
          </span>
          <span className="whitespace-nowrap text-2xl font-semibold md:text-4xl">耕海一号</span>
        </Link>
        <div className="flex items-center gap-2 rounded-[22px] border border-white/80 bg-white/62 p-1.5 shadow-soft backdrop-blur-md">
          <div className="rounded-2xl border border-sky-100 bg-sky-50 px-3.5 py-2 text-sm font-semibold text-sky-700">
            渔业检测系统
          </div>
          <button
            type="button"
            onClick={handleEnterSystem}
            disabled={entering}
            className="rounded-2xl border border-harbor-500 bg-harbor-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-harbor-500"
          >
            {entering ? "进入中" : "进入系统"}
          </button>
        </div>
      </div>

      <div className="absolute inset-0 z-0 cursor-grab active:cursor-grabbing">
        <BoatTwinScene
          hero
          modelUrl="/models/homepage-assembly-boat.glb?v=png-textures"
          colorizeModel
          colorizeLightMaterialsOnly
          showGrid={false}
          showOcean={false}
          autoRotate
          pauseAutoRotateOnInteract={false}
          float={false}
          vesselScale={1.28}
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-44 bg-[linear-gradient(0deg,rgba(232,247,252,.74)_0%,rgba(232,247,252,.3)_48%,rgba(232,247,252,0)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-[linear-gradient(180deg,rgba(241,251,255,.72)_0%,rgba(241,251,255,0)_100%)]" />

      {entering ? <EntryLoadingOverlay /> : null}
    </main>
  );
}

function EntryLoadingOverlay() {
  return (
    <div className="entry-voyage-overlay fixed inset-0 z-50 grid place-items-center overflow-hidden">
      <div className="entry-voyage-card">
        <div className="entry-voyage-stage" aria-hidden="true">
          <span className="entry-voyage-orbit entry-voyage-orbit-outer" />

          <svg className="entry-voyage-globe" viewBox="0 0 320 320">
            <defs>
              <radialGradient id="entry-ocean" cx="36%" cy="28%" r="76%">
                <stop offset="0%" stopColor="#39c2d1" />
                <stop offset="46%" stopColor="#13879b" />
                <stop offset="100%" stopColor="#063c59" />
              </radialGradient>
              <linearGradient id="entry-land" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#b9eee0" />
                <stop offset="100%" stopColor="#5ebda9" />
              </linearGradient>
              <clipPath id="entry-globe-clip">
                <circle cx="160" cy="160" r="112" />
              </clipPath>
            </defs>

            <g clipPath="url(#entry-globe-clip)">
              <circle cx="160" cy="160" r="112" fill="url(#entry-ocean)" />
              <g className="entry-voyage-world">
                <path
                  fill="url(#entry-land)"
                  d="M56 112l19-17 27-6 15 7 18-4 16 11-8 14-18 5-4 14-13 8-7 25-17 7-12-14 4-18-14-12-6-20zm101-35 17-10 20 8 9 12 21 5 13 18-8 14-18-3-8 13-19 1-10-13-18-6-7-21zm30 79 18-11 24 7 14 18-3 25-16 8-8 28-17 19-13-5 4-22-9-17-11-18 7-18zm-79 45 15-8 15 7 4 17-8 21-13 11-10-17-11-14z"
                />
              </g>

              <ellipse className="entry-voyage-gridline" cx="160" cy="160" rx="78" ry="112" />
              <ellipse className="entry-voyage-gridline" cx="160" cy="160" rx="112" ry="78" />
              <path className="entry-voyage-equator" d="M48 160h224" />
              <path
                className="entry-voyage-route"
                d="M62 184C99 109 173 96 260 153C222 210 137 231 62 184Z"
              />
            </g>
            <circle className="entry-voyage-globe-ring" cx="160" cy="160" r="112" />
            <path className="entry-voyage-globe-shine" d="M96 88c19-18 43-29 69-31" />
          </svg>

          <div className="entry-voyage-ship">
            <div className="entry-voyage-ship-body">
              <VesselIcon className="h-8 w-8" />
            </div>
            <span className="entry-voyage-ship-wake" />
          </div>
        </div>

        <p className="entry-voyage-title">正在启航</p>

        <div className="entry-voyage-progress" aria-hidden="true">
          <span />
        </div>
        <span className="sr-only">正在进入智慧渔业船监控平台</span>
      </div>
    </div>
  );
}
