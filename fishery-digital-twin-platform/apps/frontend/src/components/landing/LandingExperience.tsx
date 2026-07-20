"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ship } from "lucide-react";
import { useState } from "react";

const BoatTwinScene = dynamic(() => import("@/components/three/BoatTwinScene").then((module) => module.BoatTwinScene), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-ink-500">模型加载中</div>,
});

export function LandingExperience() {
  const router = useRouter();
  const [entering, setEntering] = useState(false);

  function handleEnterSystem() {
    if (entering) return;

    setEntering(true);
    window.setTimeout(() => {
      router.push("/dashboard");
    }, 1500);
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
            <img src="/brand-ship-logo-small.png" alt="" className="h-full w-full object-contain" />
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
        <BoatTwinScene hero showGrid={false} showOcean={false} autoRotate float={false} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-44 bg-[linear-gradient(0deg,rgba(232,247,252,.74)_0%,rgba(232,247,252,.3)_48%,rgba(232,247,252,0)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-[linear-gradient(180deg,rgba(241,251,255,.72)_0%,rgba(241,251,255,0)_100%)]" />

      {entering ? <EntryLoadingOverlay /> : null}
    </main>
  );
}

function EntryLoadingOverlay() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#e8f7fc]/94 backdrop-blur-md">
      <div className="flex flex-col items-center">
        <div className="entry-earth-wrap">
          <div className="entry-earth">
            <span className="entry-earth-line entry-earth-line-a" />
            <span className="entry-earth-line entry-earth-line-b" />
            <span className="entry-earth-glow" />
          </div>
          <div className="entry-boat-orbit">
            <div className="entry-boat">
              <Ship className="h-6 w-6" />
            </div>
          </div>
        </div>
        <p className="mt-8 text-sm font-semibold tracking-[0.18em] text-harbor-600">SYSTEM LOADING</p>
        <p className="mt-3 text-lg font-semibold text-ink-900">智慧渔业船监控平台</p>
      </div>
    </div>
  );
}
