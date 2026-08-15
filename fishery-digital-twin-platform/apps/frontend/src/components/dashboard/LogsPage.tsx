"use client";

import { useEffect, useState } from "react";
import type { SystemLog } from "@fishery/shared";
import { getSystemLogs } from "@/lib/api";
import { logLevelLabel, PageFrame, PageHeader, StatusBadge } from "@/components/dashboard/DashboardPrimitives";
import { JournalIcon } from "@/components/icons/MaritimeIcons";

export function LogsPage() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [filter, setFilter] = useState<"all" | SystemLog["level"]>("all");
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const next = await getSystemLogs();
        if (alive) {
          setLogs(next);
          setLoadError(false);
        }
      } catch {
        if (alive) setLoadError(true);
      }
    }
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const filteredLogs = filter === "all" ? logs : logs.filter((log) => log.level === filter);
  const warningCount = logs.filter((log) => log.level === "warning" || log.level === "error").length;
  const filters: Array<{ value: "all" | SystemLog["level"]; label: string }> = [
    { value: "all", label: "全部" },
    { value: "info", label: "信息" },
    { value: "success", label: "成功" },
    { value: "warning", label: "预警" },
    { value: "error", label: "异常" },
  ];

  return (
    <PageFrame wide>
      <PageHeader kicker="System Logs" title="运行日志中心" description="集中记录传感器、智能报告、舵机控制板和后端服务事件。" />

      {loadError ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">日志服务连接失败，当前保留上一次成功读取的内容。</p> : null}

      <section className="grid overflow-hidden rounded-[26px] border border-app-line bg-white shadow-soft sm:grid-cols-3">
        <div className="border-b border-app-line px-6 py-5 sm:border-b-0 sm:border-r"><p className="text-xs font-semibold text-ink-500">日志总数</p><strong className="mt-2 block text-3xl text-ink-900">{logs.length}</strong></div>
        <div className="border-b border-app-line px-6 py-5 sm:border-b-0 sm:border-r"><p className="text-xs font-semibold text-ink-500">预警与异常</p><strong className={`mt-2 block text-3xl ${warningCount > 0 ? "text-sand-500" : "text-sage-500"}`}>{warningCount}</strong></div>
        <div className="px-6 py-5"><p className="text-xs font-semibold text-ink-500">最近事件</p><strong className="mt-2 block truncate text-base text-ink-900">{logs[0]?.title || "等待系统事件"}</strong></div>
      </section>

      <section className="overflow-hidden rounded-[26px] border border-app-line bg-white shadow-soft">
        <div className="flex flex-col gap-4 border-b border-app-line bg-app-subtle/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {filters.map((item) => (
              <button key={item.value} type="button" onClick={() => setFilter(item.value)} className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${filter === item.value ? "bg-harbor-600 text-white shadow-sm" : "bg-white text-ink-500 hover:text-ink-900"}`}>{item.label}</button>
            ))}
          </div>
          <span className="text-xs font-semibold text-ink-500">每 5 秒自动刷新</span>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="grid min-h-[360px] place-items-center px-6 text-center">
            <div><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-harbor-100 text-harbor-600"><JournalIcon className="h-6 w-6" /></span><h2 className="mt-5 text-base font-semibold text-ink-900">{logs.length === 0 ? "暂无运行日志" : "当前筛选条件下无记录"}</h2><p className="mt-2 text-sm text-ink-500">{logs.length === 0 ? "后端服务、设备控制或分析任务产生事件后，将按时间顺序显示在这里。" : "请选择其他日志级别查看记录。"}</p></div>
          </div>
        ) : (
          <div className="soft-scrollbar max-h-[650px] overflow-auto">
            <div className="hidden grid-cols-[110px_92px_150px_minmax(180px,.8fr)_minmax(260px,1.2fr)] gap-4 border-b border-app-line bg-white px-6 py-3 text-xs font-semibold text-ink-500 lg:grid"><span>时间</span><span>级别</span><span>来源</span><span>事件</span><span>详情</span></div>
            {filteredLogs.map((log) => (
              <article key={log.id} className="grid gap-3 border-b border-app-line px-6 py-5 last:border-b-0 lg:grid-cols-[110px_92px_150px_minmax(180px,.8fr)_minmax(260px,1.2fr)] lg:items-start lg:gap-4">
                <time className="text-xs font-semibold text-ink-500">{new Date(log.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                <StatusBadge text={logLevelLabel(log.level)} tone={log.level === "success" ? "good" : log.level === "warning" || log.level === "error" ? "warn" : "neutral"} />
                <span className="truncate text-xs font-semibold text-ink-500">{log.source || "system"}</span>
                <strong className="text-sm text-ink-900">{log.title}</strong>
                <p className="text-sm leading-6 text-ink-500">{log.detail}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </PageFrame>
  );
}
