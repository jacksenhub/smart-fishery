"use client";

import { useEffect, useState, type ElementType, type ReactNode } from "react";
import type { SystemLog } from "@fishery/shared";

export function PageFrame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={`mx-auto space-y-6 ${wide ? "max-w-[1380px]" : "max-w-[1160px]"}`}>{children}</div>;
}

export function PageHeader({ title }: { kicker?: string; title: string; description: string }) {
  return (
    <header className="max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-normal text-ink-900 md:text-3xl">{title}</h1>
    </header>
  );
}

export function logLevelLabel(level: SystemLog["level"]) {
  if (level === "success") return "成功";
  if (level === "warning") return "预警";
  if (level === "error") return "异常";
  return "信息";
}

export function InfoPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-app-line bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold text-ink-500">{label}</p>
      <strong className="mt-3 block text-lg font-semibold text-ink-900">{value}</strong>
    </div>
  );
}

export function TextList({ title, items }: { title: string; items: string[] }) {
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

export function StatusBadge({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "good" | "warn" }) {
  const toneClass = tone === "good"
    ? "border-sage-500/20 bg-sage-100 text-sage-500"
    : tone === "warn"
      ? "border-sand-500/20 bg-sand-100 text-sand-500"
      : "border-app-line bg-white text-ink-500";
  return <span className={`inline-flex w-fit items-center rounded-full border px-3 py-1.5 text-xs font-semibold ${toneClass}`}>{text}</span>;
}

export function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  primary = false,
}: {
  icon: ElementType<{ className?: string; strokeWidth?: number }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2.5 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-50 ${
        primary
          ? "border-harbor-600 bg-harbor-600 text-white hover:bg-harbor-500"
          : "border-app-line bg-white text-ink-700 hover:border-harbor-500/40 hover:text-harbor-600"
      }`}
    >
      <span className={`grid h-7 w-7 place-items-center rounded-full ${primary ? "bg-white/14 text-white" : "bg-harbor-50 text-harbor-600"}`}>
        <Icon className="h-4 w-4" strokeWidth={1.8} />
      </span>
      {label}
    </button>
  );
}

export function EmptyPanel({ text }: { text: string }) {
  return <div className="grid h-full min-h-[240px] place-items-center rounded-2xl bg-app-subtle text-sm font-semibold text-ink-500">{text}</div>;
}

export function useVisualReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return ready;
}
