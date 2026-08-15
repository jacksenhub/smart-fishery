"use client";

import { CircleStop, Crosshair, LocateFixed, RotateCcw } from "lucide-react";
import {
  NavigationCameraPanel,
  type CameraTrackingObservation,
  type CameraTrackingProfile,
} from "@/components/dashboard/NavigationCameraPanel";

export type GimbalDirection = "up" | "down" | "left" | "right";
export type GimbalTrackingStatus = "off" | "waiting" | "acquiring" | "tracking" | "locked" | "lost" | "safety" | "limit" | "error";

type GimbalTargetControllerProps = {
  online: boolean;
  busy: boolean;
  horizontalTargetAngle: number;
  verticalTargetAngle: number;
  horizontalActualAngle: number | null;
  verticalActualAngle: number | null;
  stepDegrees: number;
  maximumAngle: number;
  activeDirection: GimbalDirection | null;
  autoTrackingEnabled: boolean;
  trackingStatus: GimbalTrackingStatus;
  trackingTargetLabel: string | null;
  trackingObservation: CameraTrackingObservation | null;
  trackingProfile: CameraTrackingProfile;
  trackingSafetyBlocked: boolean;
  error?: string | null;
  onDirection: (direction: GimbalDirection) => void;
  onCenter: () => void;
  onAutoTrackingToggle: () => void;
  onTrackingProfileChange: (profile: CameraTrackingProfile) => void;
  onTrackingObservation: (observation: CameraTrackingObservation | null) => void;
  onTrackingSafetyChange: (blocked: boolean) => void;
};

const CAMERA_HORIZONTAL_FOV_DEGREES = 70;
const CAMERA_VERTICAL_FOV_DEGREES = 43;
const TARGET_DEAD_ZONE_RATIO = 0.02;
const GIMBAL_NEUTRAL_ANGLE = 90;

export function GimbalTargetController({
  online,
  busy,
  horizontalTargetAngle,
  verticalTargetAngle,
  horizontalActualAngle,
  verticalActualAngle,
  stepDegrees,
  maximumAngle,
  activeDirection,
  autoTrackingEnabled,
  trackingStatus,
  trackingTargetLabel,
  trackingObservation,
  trackingProfile,
  trackingSafetyBlocked,
  error,
  onDirection,
  onCenter,
  onAutoTrackingToggle,
  onTrackingProfileChange,
  onTrackingObservation,
  onTrackingSafetyChange,
}: GimbalTargetControllerProps) {
  // Next.js fast refresh can temporarily preserve the removed "laptop-test" state.
  const effectiveTrackingProfile: CameraTrackingProfile = trackingProfile === "trash"
    ? "trash"
    : "bottle-test";
  const safeTrackingObservation = trackingSafetyBlocked ? null : trackingObservation;
  const displayHorizontal = horizontalActualAngle ?? horizontalTargetAngle;
  const displayVertical = verticalActualAngle ?? verticalTargetAngle;
  const feedback = describeTargetFeedback(safeTrackingObservation);
  const targetMarker = safeTrackingObservation
    ? {
        x: Math.min(100, Math.max(0, (safeTrackingObservation.centerX / safeTrackingObservation.frameWidth) * 100)),
        y: Math.min(100, Math.max(0, (safeTrackingObservation.centerY / safeTrackingObservation.frameHeight) * 100)),
      }
    : null;
  const disabled = !online || busy;
  const activeDirectionLabel = activeDirection
    ? ({ up: "向上", down: "向下", left: "向左", right: "向右" } as const)[activeDirection]
    : null;
  const trackingStatusLabel = trackingStatus === "waiting"
    ? "等待识别目标"
    : trackingStatus === "acquiring"
      ? "正在确认目标"
      : trackingStatus === "tracking"
        ? `跟踪 ${trackingTargetLabel ?? "目标"}`
        : trackingStatus === "locked"
          ? `已对准 ${trackingTargetLabel ?? "目标"}`
          : trackingStatus === "lost"
            ? "目标已丢失"
            : trackingStatus === "safety"
              ? "检测到人员，跟踪暂停"
            : trackingStatus === "limit"
              ? "已到舵机限位"
              : trackingStatus === "error"
                ? "自动跟踪异常"
                : "自动跟踪关闭";

  return (
    <section className="mt-6 overflow-hidden rounded-[26px] border border-app-line bg-white shadow-soft">
      <header className="flex flex-col gap-4 border-b border-app-line bg-[linear-gradient(110deg,#f8fbfb_0%,#eef9f8_100%)] px-5 py-5 sm:flex-row sm:items-center sm:justify-between md:px-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-harbor-100 text-harbor-600">
              <Crosshair className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-ink-900">水枪靶向控制</h2>
              <p className="mt-1 text-xs font-semibold text-ink-500">
          开发板 1
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl border border-app-line bg-white/80 p-1 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => onTrackingProfileChange("trash")}
              disabled={busy}
              className={`rounded-lg px-3 py-2 transition disabled:opacity-40 ${effectiveTrackingProfile === "trash" ? "bg-harbor-600 text-white shadow-sm" : "text-ink-500 hover:text-harbor-600"}`}
            >
              水面垃圾
            </button>
            <button
              type="button"
              onClick={() => onTrackingProfileChange("bottle-test")}
              disabled={busy}
              className={`rounded-lg px-3 py-2 transition disabled:opacity-40 ${effectiveTrackingProfile === "bottle-test" ? "bg-harbor-600 text-white shadow-sm" : "text-ink-500 hover:text-harbor-600"}`}
            >
              瓶子测试
            </button>
          </div>
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
              online
                ? activeDirection
                  ? "border-harbor-500/20 bg-harbor-100 text-harbor-600"
                  : "border-sage-500/20 bg-sage-100 text-sage-500"
                : "border-app-line bg-app-subtle text-ink-500"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${online ? activeDirection ? "animate-pulse bg-harbor-500" : "bg-sage-500" : "bg-ink-500/55"}`} />
            {online ? activeDirectionLabel ? `${activeDirectionLabel}运动中` : "开发板 1 在线" : "开发板 1 离线"}
          </span>
          <button
            type="button"
            onClick={onAutoTrackingToggle}
            disabled={!online || busy}
            className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${
              autoTrackingEnabled
                ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                : "border-harbor-500/25 bg-harbor-50 text-harbor-600 hover:border-harbor-500/45 hover:bg-harbor-100"
            }`}
          >
            {autoTrackingEnabled ? <CircleStop className="h-4 w-4" /> : <LocateFixed className="h-4 w-4" />}
            {autoTrackingEnabled ? "停止自动跟踪" : "开启自动跟踪"}
          </button>
          <button
            type="button"
            onClick={onCenter}
            disabled={disabled}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-harbor-500/25 bg-harbor-50 px-4 text-xs font-semibold text-harbor-600 transition hover:border-harbor-500/45 hover:bg-harbor-100 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <RotateCcw className="h-4 w-4" />
            一键归中
          </button>
        </div>
      </header>

      <div className="p-4 sm:p-6">
        <div className="mx-auto w-full max-w-[1200px] overflow-hidden rounded-[20px] border border-app-line bg-white shadow-[0_14px_42px_rgba(16,42,54,0.08)]">
          <div className="relative h-[440px] overflow-hidden bg-[linear-gradient(180deg,rgba(15,23,42,0.94),rgba(8,47,58,0.86))] sm:h-[780px]">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.11]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(103,232,249,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(103,232,249,0.22) 1px, transparent 1px)",
                backgroundSize: "38px 38px",
              }}
            />
            <div className="pointer-events-none absolute left-4 top-3 z-20 text-[10px] font-semibold tracking-[0.16em] text-slate-500 sm:left-5 sm:top-4">
              云台瞄准区
            </div>
            <div className="pointer-events-none absolute right-4 top-3 z-20 text-right text-[10px] font-semibold text-slate-500 sm:right-5 sm:top-4">
              水平 {Math.round(displayHorizontal)}° · 俯仰 {Math.round(displayVertical)}°
            </div>

            <div className="absolute left-1/2 top-1/2 h-[390px] w-[94%] max-w-[1120px] -translate-x-1/2 -translate-y-1/2 sm:h-[700px]">
              <svg
                aria-hidden="true"
                viewBox="0 0 1000 620"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 h-full w-full drop-shadow-[0_0_28px_rgba(34,211,238,0.12)]"
              >
                <polygon
                  points="78,2 922,2 998,78 998,542 922,618 78,618 2,542 2,78"
                  fill="rgba(6,182,212,0.025)"
                  stroke="rgba(103,232,249,0.62)"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
                <polygon
                  points="96,22 904,22 978,96 978,524 904,598 96,598 22,524 22,96"
                  fill="none"
                  stroke="rgba(103,232,249,0.15)"
                  strokeWidth="1"
                  strokeDasharray="8 11"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>

              <HudReadout
                className="left-[9%] top-[5%]"
                label="水平轴"
                value={`GPIO26 · ${horizontalTargetAngle}°`}
              />
              <HudReadout
                className="right-[9%] top-[5%] items-end text-right"
                label="俯仰轴"
                value={`GPIO25 · ${formatRelativePitch(verticalTargetAngle)} · 指令 ${verticalTargetAngle}°`}
              />
              <HudReadout
                className="bottom-[5%] left-[9%]"
                label="控制步进"
                value={`${stepDegrees}° / 次`}
              />
              <HudReadout
                className="bottom-[5%] right-[9%] items-end text-right"
                label="云台链路"
                value={online ? activeDirectionLabel ? `${activeDirectionLabel}连续运动` : busy ? "指令发送中" : "在线待命" : "设备离线"}
                active={online}
              />

              <DirectionTriangle
                direction="up"
                label="向上"
                active={activeDirection === "up"}
                disabled={disabled || (activeDirection !== "up" && verticalTargetAngle <= 0)}
                onClick={() => onDirection("up")}
              />
              <DirectionTriangle
                direction="down"
                label="向下"
                active={activeDirection === "down"}
                disabled={disabled || (activeDirection !== "down" && verticalTargetAngle >= maximumAngle)}
                onClick={() => onDirection("down")}
              />
              <DirectionTriangle
                direction="left"
                label="向左"
                active={activeDirection === "left"}
                disabled={disabled || (activeDirection !== "left" && horizontalTargetAngle >= maximumAngle)}
                onClick={() => onDirection("left")}
              />
              <DirectionTriangle
                direction="right"
                label="向右"
                active={activeDirection === "right"}
                disabled={disabled || (activeDirection !== "right" && horizontalTargetAngle <= 0)}
                onClick={() => onDirection("right")}
              />

              <div className="absolute left-1/2 top-1/2 h-[62%] w-[72%] -translate-x-1/2 -translate-y-1/2 overflow-hidden border-2 border-cyan-200/75 bg-[linear-gradient(145deg,rgba(8,47,73,0.48),rgba(15,23,42,0.8))] shadow-[0_0_42px_rgba(34,211,238,0.17)] sm:h-auto sm:aspect-video sm:w-[82%]">
                <NavigationCameraPanel
                  embedded
                  cameraPurpose="gimbal-tracking"
                  trackingEnabled={autoTrackingEnabled}
                  trackingProfile={effectiveTrackingProfile}
                  onTrackingObservation={onTrackingObservation}
                  onTrackingSafetyChange={onTrackingSafetyChange}
                />
                <div className="pointer-events-none absolute left-1/2 top-0 z-20 h-full w-px -translate-x-1/2 bg-cyan-200/28" />
                <div className="pointer-events-none absolute left-0 top-1/2 z-20 h-px w-full -translate-y-1/2 bg-cyan-200/28" />
                <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-7 w-7 -translate-x-1/2 -translate-y-1/2 border border-cyan-100/75 bg-cyan-300/8 shadow-[0_0_14px_rgba(103,232,249,0.22)]" />
                {targetMarker ? (
                  <>
                    <svg
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 z-20 h-full w-full"
                    >
                      <line
                        x1="50"
                        y1="50"
                        x2={targetMarker.x}
                        y2={targetMarker.y}
                        stroke={feedback.locked ? "#86efac" : "#fbbf24"}
                        strokeWidth="1.5"
                        strokeDasharray="1.5 1.2"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute z-30 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-[left,top] duration-200 ${
                        feedback.locked
                          ? "border-emerald-300 bg-emerald-300/25 shadow-[0_0_16px_rgba(110,231,183,0.8)]"
                          : "border-amber-300 bg-amber-300/20 shadow-[0_0_16px_rgba(252,211,77,0.65)]"
                      }`}
                      style={{ left: `${targetMarker.x}%`, top: `${targetMarker.y}%` }}
                    >
                      <span className={`absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${feedback.locked ? "bg-emerald-200" : "bg-amber-200"}`} />
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="border-t border-app-line bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-line pb-4">
            <div className="flex items-center gap-2">
              <LocateFixed className="h-4 w-4 text-harbor-600" />
              <h3 className="text-sm font-semibold text-ink-900">目标位置反馈</h3>
            </div>
            <span className={`text-[11px] font-semibold ${trackingSafetyBlocked ? "text-red-600" : safeTrackingObservation ? feedback.locked ? "text-sage-500" : "text-sand-500" : "text-ink-500"}`}>
              {trackingSafetyBlocked
                ? "人员靠近目标区域，安全暂停"
                : autoTrackingEnabled
                ? trackingStatusLabel
                : safeTrackingObservation
                  ? `识别到 ${safeTrackingObservation.label} · ${Math.round(safeTrackingObservation.score * 100)}%`
                  : "等待摄像头识别目标"}
            </span>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[0.8fr_0.9fr_1.7fr]">
            <FeedbackText label="偏差方向" value={trackingSafetyBlocked ? "安全暂停" : feedback.direction} active={Boolean(safeTrackingObservation)} />
            <FeedbackText label="准星偏差" value={trackingSafetyBlocked ? "--" : feedback.distance} active={Boolean(safeTrackingObservation)} />
            <FeedbackText label="修正建议" value={trackingSafetyBlocked ? "请等待人员离开目标附近后重新确认" : feedback.suggestion} active={Boolean(safeTrackingObservation)} />
          </div>

          {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function formatRelativePitch(angle: number) {
  const offset = Math.round(angle - GIMBAL_NEUTRAL_ANGLE);
  if (offset === 0) return "中位 0°";
  return `相对 ${offset > 0 ? "+" : ""}${offset}°`;
}

function HudReadout({
  className,
  label,
  value,
  active = true,
}: {
  className: string;
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className={`pointer-events-none absolute hidden flex-col sm:flex ${className}`}>
      <span className="text-[9px] font-semibold tracking-[0.14em] text-slate-500">{label}</span>
      <strong className={`mt-1 text-[11px] font-semibold ${active ? "text-cyan-200/85" : "text-slate-500"}`}>
        {value}
      </strong>
      <span className={`mt-1 h-px w-20 ${active ? "bg-cyan-300/35" : "bg-slate-600/50"}`} />
    </div>
  );
}

function DirectionTriangle({
  direction,
  label,
  active,
  disabled,
  onClick,
}: {
  direction: GimbalDirection;
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const positionClass =
    direction === "up"
      ? "left-1/2 top-[2%] -translate-x-1/2"
      : direction === "down"
        ? "bottom-[2%] left-1/2 -translate-x-1/2"
        : direction === "left"
          ? "left-[2%] top-1/2 -translate-y-1/2"
          : "right-[2%] top-1/2 -translate-y-1/2";
  const rotation =
    direction === "up"
      ? 0
      : direction === "right"
        ? 90
        : direction === "down"
          ? 180
          : -90;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group absolute z-10 grid h-12 w-12 place-items-center transition active:scale-90 disabled:cursor-not-allowed disabled:text-slate-600 disabled:opacity-55 sm:h-16 sm:w-16 ${active ? "text-red-400" : "text-cyan-300 hover:text-cyan-100"} ${positionClass}`}
      aria-label={active ? `停止${label}运动` : `开始${label}连续运动`}
      title={active ? `停止${label}运动` : `${label} ${label === "向上" || label === "向下" ? "俯仰" : "水平"}舵机`}
    >
      {active ? (
        <span className="grid h-11 w-11 place-items-center rounded-full border-2 border-red-300 bg-red-500 text-white shadow-[0_0_24px_rgba(239,68,68,0.5)] sm:h-14 sm:w-14">
          <CircleStop className="h-6 w-6 sm:h-8 sm:w-8" strokeWidth={2.4} />
        </span>
      ) : (
        <svg
          viewBox="0 0 64 64"
          aria-hidden="true"
          className="h-10 w-10 drop-shadow-[0_0_12px_rgba(34,211,238,0.38)] transition group-hover:drop-shadow-[0_0_18px_rgba(103,232,249,0.55)] sm:h-14 sm:w-14"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <path
            d="M32 8 55 52H9L32 8Z"
            fill="currentColor"
            fillOpacity="0.1"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function FeedbackText({
  label,
  value,
  active,
}: {
  label: string;
  value: string;
  active: boolean;
}) {
  return (
    <div className="rounded-xl border border-app-line bg-app-subtle px-4 py-3">
      <p className="text-[11px] font-semibold text-ink-500">{label}</p>
      <strong className={`mt-1.5 block text-sm font-semibold leading-6 ${active ? "text-ink-900" : "text-ink-500"}`}>
        {value}
      </strong>
    </div>
  );
}

function describeTargetFeedback(observation: CameraTrackingObservation | null) {
  if (!observation) {
    return {
      direction: "等待目标",
      distance: "--",
      suggestion: "启动摄像头，并将识别目标移入画面",
      locked: false,
    };
  }

  const horizontalPixels = observation.centerX - observation.frameWidth / 2;
  const verticalPixels = observation.centerY - observation.frameHeight / 2;
  const horizontalRatio = horizontalPixels / observation.frameWidth;
  const verticalRatio = verticalPixels / observation.frameHeight;
  const horizontalDirection =
    horizontalRatio > TARGET_DEAD_ZONE_RATIO
      ? "右"
      : horizontalRatio < -TARGET_DEAD_ZONE_RATIO
        ? "左"
        : "";
  const verticalDirection =
    verticalRatio > TARGET_DEAD_ZONE_RATIO
      ? "下"
      : verticalRatio < -TARGET_DEAD_ZONE_RATIO
        ? "上"
        : "";
  const directions = [verticalDirection, horizontalDirection].filter(Boolean);
  const horizontalAngle = Math.atan(
    horizontalRatio * 2 * Math.tan((CAMERA_HORIZONTAL_FOV_DEGREES * Math.PI) / 360),
  ) * 180 / Math.PI;
  const verticalAngle = Math.atan(
    verticalRatio * 2 * Math.tan((CAMERA_VERTICAL_FOV_DEGREES * Math.PI) / 360),
  ) * 180 / Math.PI;
  const pixelDistance = Math.hypot(horizontalPixels, verticalPixels);
  const angularDistance = Math.hypot(horizontalAngle, verticalAngle);

  if (directions.length === 0) {
    return {
      direction: "准星中心",
      distance: `${Math.round(pixelDistance)} px / 估算 ${angularDistance.toFixed(1)}°`,
      suggestion: "目标已进入中心死区，保持当前方向",
      locked: true,
    };
  }

  const corrections = [
    horizontalDirection
      ? `水平向${horizontalDirection}${Math.abs(horizontalAngle).toFixed(1)}°`
      : "",
    verticalDirection
      ? `俯仰向${verticalDirection}${Math.abs(verticalAngle).toFixed(1)}°`
      : "",
  ].filter(Boolean);

  return {
    direction: directions.join(" / "),
    distance: `${Math.round(pixelDistance)} px / 估算 ${angularDistance.toFixed(1)}°`,
    suggestion: `建议${corrections.join("、")}，将目标移入准星`,
    locked: false,
  };
}
