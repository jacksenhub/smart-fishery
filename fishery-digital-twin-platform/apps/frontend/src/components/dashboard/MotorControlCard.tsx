"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CircleStop, Gauge, MoveVertical, ShieldAlert } from "lucide-react";
import type { PropulsionDevice } from "@fishery/shared";
import { setPropulsionTarget } from "@/lib/api";
import { platformStore } from "@/lib/platformStore";
import { InsightIcon } from "@/components/icons/MaritimeIcons";

export type MotorControlConfig = {
  deviceId: string;
  title: string;
  description?: string;
  boardLabel: string;
  kind: "rotary" | "linear";
  maxPower: number;
  defaultPower: number;
  positiveLabel: string;
  negativeLabel: string;
  momentary: boolean;
  directionMultiplier?: 1 | -1;
  showRuntimeProtection?: boolean;
  showBoardFeedback?: boolean;
  showDeviceId?: boolean;
};

export function MotorControlCard({
  config,
  device,
  embedded = false,
}: {
  config: MotorControlConfig;
  device?: PropulsionDevice;
  embedded?: boolean;
}) {
  const [power, setPower] = useState(config.defaultPower);
  const [targetPower, setTargetPower] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const activeTargetRef = useRef(0);
  const actualPower = device?.actual_left_power ?? 0;
  const directionMultiplier = config.directionMultiplier ?? 1;
  const logicalTargetPower = targetPower * directionMultiplier;
  const logicalActualPower = actualPower * directionMultiplier;
  const logicalDirectionPower = logicalActualPower !== 0 ? logicalActualPower : logicalTargetPower;
  const feedbackTimestampMs = device?.last_seen ? Date.parse(device.last_seen) : clockMs;
  const elapsedSinceFeedbackMs = Number.isFinite(feedbackTimestampMs)
    ? Math.max(0, clockMs - feedbackTimestampMs)
    : 0;
  const runtimeLockout = Boolean(config.showRuntimeProtection && device?.runtime_lockout);
  const cooldownRemainingMs = config.showRuntimeProtection
    ? Math.max(0, (device?.cooldown_remaining_ms ?? 0) - elapsedSinceFeedbackMs)
    : 0;
  const runRemainingMs = config.showRuntimeProtection
    ? Math.max(0, (device?.run_remaining_ms ?? 0) - elapsedSinceFeedbackMs)
    : 0;
  const runActive = Boolean(config.showRuntimeProtection && device?.run_active);
  const cyclePhase = config.showRuntimeProtection
    ? device?.cycle_phase ?? "idle"
    : "idle";
  const cycleRunMs = config.showRuntimeProtection
    ? Math.max(0, device?.cycle_run_ms ?? 0)
    : 0;
  const dutyRunMs = config.showRuntimeProtection
    ? Math.min(120_000, Math.max(0, (device?.duty_run_ms ?? 0) + (runActive ? elapsedSinceFeedbackMs : 0)))
    : 0;
  const dutyRemainingMs = config.showRuntimeProtection
    ? Math.max(0, (device?.duty_remaining_ms ?? 120_000) - (runActive ? elapsedSinceFeedbackMs : 0))
    : 0;
  const roundTripCount = config.showRuntimeProtection
    ? Math.max(0, device?.round_trip_count ?? 0)
    : 0;
  const roundTripLimit = config.showRuntimeProtection
    ? Math.max(1, device?.round_trip_limit ?? 4)
    : 4;
  const directionControlsDisabled = !device?.online || runtimeLockout || cooldownRemainingMs > 0;
  const positiveActive = !directionControlsDisabled && logicalTargetPower > 0;
  const negativeActive = !directionControlsDisabled && logicalTargetPower < 0;
  const runningState = !device?.online
    ? "离线"
    : device.emergency_stop
      ? "紧急停止"
      : runtimeLockout
        ? "等待点击停止"
        : cooldownRemainingMs > 0
          ? "冷却中"
          : cyclePhase === "awaiting_return"
            ? "等待反向行程"
          : logicalActualPower > 0
            ? config.positiveLabel
            : logicalActualPower < 0
              ? config.negativeLabel
              : "停止";

  const sendMotorCommand = useCallback(async (
    outputPower: number,
    enabled: boolean,
    emergencyStop = false,
    updateUi = true,
  ) => {
    if (updateUi) setError(null);

    try {
      const result = await setPropulsionTarget({
        device_id: config.deviceId,
        mode: "WEB",
        enabled,
        emergency_stop: emergencyStop,
        throttle: outputPower,
        steering: 0,
        max_power: config.maxPower,
      });
      platformStore.applyFeedback({ propulsion: result.propulsion });
    } catch (commandError) {
      if (updateUi) {
        setError(commandError instanceof Error ? commandError.message : "电机命令发送失败");
      }
    }
  }, [config.deviceId, config.maxPower]);

  useEffect(() => {
    activeTargetRef.current = targetPower;
    if (targetPower === 0) return;

    const sendHeartbeat = () => {
      void sendMotorCommand(targetPower, true);
    };
    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 800);
    return () => window.clearInterval(timer);
  }, [sendMotorCommand, targetPower]);

  useEffect(() => {
    if (!config.showRuntimeProtection) return;
    setClockMs(Date.now());
    const timer = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [config.showRuntimeProtection]);

  useEffect(() => {
    if (device?.online || targetPower === 0) return;
    setTargetPower(0);
    void sendMotorCommand(0, false);
  }, [device?.online, sendMotorCommand, targetPower]);

  useEffect(() => () => {
    if (activeTargetRef.current !== 0) {
      void sendMotorCommand(0, false, false, false);
    }
  }, [sendMotorCommand]);

  function startMotor(direction: 1 | -1) {
    if (!device?.online) {
      setError(`${config.boardLabel}未在线`);
      return;
    }
    if (runtimeLockout) {
      setError("请先点击中间的“停止”按钮，解除固件安全锁定");
      return;
    }
    if (cooldownRemainingMs > 0) {
      setError(`推杆正在冷却，剩余 ${formatDuration(cooldownRemainingMs)}`);
      return;
    }
    setError(null);
    setTargetPower(direction * power * directionMultiplier);
  }

  function stopMotor() {
    activeTargetRef.current = 0;
    setTargetPower(0);
    void sendMotorCommand(0, false);
  }

  function emergencyStopMotor() {
    activeTargetRef.current = 0;
    setTargetPower(0);
    void sendMotorCommand(0, false, true);
  }

  function renderDirectionButton(direction: 1 | -1) {
    const positive = direction > 0;
    const label = positive ? config.positiveLabel : config.negativeLabel;
    const active = positive ? positiveActive : negativeActive;
    const toneClass = active
      ? "border-harbor-600 bg-harbor-600 text-white shadow-[0_10px_24px_rgba(15,127,138,0.22)]"
      : positive
        ? "border-sage-500/25 bg-sage-100 text-sage-500 hover:border-sage-500/45 hover:bg-sage-100/75"
        : "border-sand-500/25 bg-sand-100 text-sand-500 hover:border-sand-500/45 hover:bg-sand-100/75";
    const activeClass = active ? "ring-2 ring-harbor-500/30 ring-offset-2 ring-offset-white" : "";
    const Icon = positive ? ArrowUp : ArrowDown;

    if (!config.momentary) {
      return (
        <button
          type="button"
          onClick={() => startMotor(direction)}
          disabled={directionControlsDisabled}
          className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${toneClass} ${activeClass}`}
        >
          <Icon size={17} aria-hidden="true" />
          {label}
        </button>
      );
    }

    return (
      <button
        type="button"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          startMotor(direction);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          stopMotor();
        }}
        onPointerCancel={stopMotor}
        onLostPointerCapture={() => {
          if (activeTargetRef.current !== 0) stopMotor();
        }}
        onKeyDown={(event) => {
          if (!event.repeat && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            startMotor(direction);
          }
        }}
        onKeyUp={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            stopMotor();
          }
        }}
        onBlur={() => {
          if (activeTargetRef.current !== 0) stopMotor();
        }}
        disabled={directionControlsDisabled}
        className={`touch-none select-none inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${toneClass} ${activeClass}`}
      >
        <Icon size={17} aria-hidden="true" />
        按住{label}
      </button>
    );
  }

  return (
    <section className={embedded
      ? "h-full min-w-0 bg-transparent"
      : "overflow-hidden rounded-[26px] border border-app-line bg-white shadow-soft"
    }>
      <div className={embedded ? "flex h-full flex-col p-5 md:p-6" : "p-5 md:p-6"}>
        <div className="flex flex-col gap-3 border-b border-app-line pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(145deg,#e2f5f3_0%,#edf6fb_100%)] text-harbor-600 shadow-[inset_0_0_0_1px_rgba(15,127,138,0.08)]">
              {config.kind === "rotary" ? <Gauge className="h-5 w-5" /> : <MoveVertical className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-harbor-600">{config.boardLabel}</p>
              <h2 className="mt-1 text-xl font-semibold text-ink-900">{config.title}</h2>
              {config.description ? (
                <p className="mt-1 text-sm text-ink-500">{config.description}</p>
              ) : null}
              {config.showDeviceId !== false ? (
                <p className="mt-1 truncate text-[11px] font-semibold text-ink-500/75">{config.deviceId}</p>
              ) : null}
            </div>
          </div>
          <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
            device?.online
              ? "border-sage-500/20 bg-sage-100 text-sage-500"
              : "border-app-line bg-app-subtle text-ink-500"
          }`}>
            <span className={`h-2 w-2 rounded-full ${device?.online ? "bg-sage-500" : "bg-ink-500/55"}`} />
            {device?.online ? "在线" : "离线"}
          </span>
        </div>

        {config.showRuntimeProtection ? (
          <RuntimeProtectionNotice
            online={Boolean(device?.online)}
            runtimeLockout={runtimeLockout}
            cooldownRemainingMs={cooldownRemainingMs}
            runActive={runActive}
            runRemainingMs={runRemainingMs}
            cyclePhase={cyclePhase}
            cycleRunMs={cycleRunMs}
            dutyRunMs={dutyRunMs}
            roundTripCount={roundTripCount}
            roundTripLimit={roundTripLimit}
            runningLabel={logicalDirectionPower >= 0 ? config.positiveLabel : config.negativeLabel}
          />
        ) : null}

        <div className="mt-5 rounded-[24px] border border-harbor-500/15 bg-[linear-gradient(145deg,#f5fbfb_0%,#edf7f6_52%,#f7fafc_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] sm:p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <label htmlFor={`${config.deviceId}-power`} className="text-sm font-semibold text-ink-700">输出功率</label>
              <p className="mt-1 text-xs text-ink-500">拖动滑块设置本次控制强度</p>
            </div>
            <div className="text-right">
              <strong className="text-4xl font-semibold tabular-nums text-harbor-600">{power}</strong>
              <span className="ml-1 text-sm font-semibold text-harbor-600">%</span>
            </div>
          </div>
          <input
            id={`${config.deviceId}-power`}
            type="range"
            min="5"
            max={config.maxPower}
            step="1"
            value={power}
            onChange={(event) => {
              const nextPower = Number(event.target.value);
              setPower(nextPower);
              if (targetPower !== 0) {
                setTargetPower(Math.sign(targetPower) * nextPower);
              }
            }}
            className="servo-range mt-5 w-full"
          />
          <div className="mt-2 flex justify-between text-[11px] font-semibold text-ink-500">
            <span>低速 5%</span>
            <span>固件上限 {config.maxPower}%</span>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            {renderDirectionButton(1)}
            <button
              type="button"
              onClick={stopMotor}
              disabled={!device?.online}
              className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-app-line bg-white px-3 py-3 text-sm font-semibold text-ink-700 shadow-sm transition-all hover:border-harbor-500/45 hover:text-harbor-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CircleStop size={18} aria-hidden="true" />
              停止
            </button>
            {renderDirectionButton(-1)}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-app-line bg-white p-2">
          <MotorStateMetric label="当前状态" value={runningState} />
          <MotorStateMetric label="目标输出" value={`${logicalTargetPower > 0 ? "+" : ""}${logicalTargetPower}%`} />
          <MotorStateMetric label="反馈输出" value={`${logicalActualPower > 0 ? "+" : ""}${logicalActualPower}%`} />
        </div>

        <button
          type="button"
          onClick={emergencyStopMotor}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition-all hover:border-red-300 hover:bg-red-100 active:scale-[0.99]"
        >
          <ShieldAlert size={17} aria-hidden="true" />
          紧急停止
        </button>

        {config.showBoardFeedback !== false ? (
          <>
            <div className="mt-5 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink-900">开发板反馈</h3>
              </div>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-harbor-50 text-harbor-600">
                <InsightIcon className="h-5 w-5" />
              </span>
            </div>
            <div className="mt-4 divide-y divide-app-line rounded-2xl border border-app-line bg-app-subtle px-4">
              <MotorFeedbackRow label="PWM 输出" value={`${actualPower > 0 ? "+" : ""}${actualPower}%`} />
              {config.kind === "rotary" ? (
                <>
                  <MotorFeedbackRow label="实际转速" value="未接转速传感器" muted />
                  <MotorFeedbackRow label="电流反馈" value="未接电流传感器" muted />
                </>
              ) : null}
              {config.showRuntimeProtection ? (
                <>
                  <MotorFeedbackRow
                    label="安全锁定"
                    value={runtimeLockout ? "等待点击停止" : "已解除"}
                    tone={runtimeLockout ? "warn" : "good"}
                  />
                  <MotorFeedbackRow
                    label="往返周期"
                    value={cyclePhaseLabel(cyclePhase)}
                    tone={cyclePhase === "awaiting_return"
                      ? "good"
                      : cyclePhase === "cooling"
                        ? "warn"
                        : "normal"}
                  />
                  {cyclePhase !== "idle" && cyclePhase !== "cooling" ? (
                    <MotorFeedbackRow
                      label="周期累计运行"
                      value={formatDuration(cycleRunMs)}
                    />
                  ) : null}
                  <MotorFeedbackRow
                    label="完整往返次数"
                    value={`${roundTripCount} / ${roundTripLimit}`}
                    tone={roundTripCount >= roundTripLimit - 1 ? "warn" : "good"}
                  />
                  <MotorFeedbackRow
                    label="累计通电时间"
                    value={`${formatDuration(dutyRunMs)} / 02:00`}
                  />
                  <MotorFeedbackRow
                    label="剩余工作额度"
                    value={cooldownRemainingMs > 0 ? "等待冷却完成" : formatDuration(dutyRemainingMs)}
                    tone={dutyRemainingMs <= 15_000 ? "warn" : "good"}
                  />
                  <MotorFeedbackRow
                    label="剩余冷却时间"
                    value={cooldownRemainingMs > 0 ? formatDuration(cooldownRemainingMs) : "可以启动"}
                    tone={cooldownRemainingMs > 0 ? "warn" : "good"}
                  />
                  {runActive ? (
                    <MotorFeedbackRow
                      label="剩余可运行时间"
                      value={formatDuration(runRemainingMs)}
                      tone="good"
                    />
                  ) : null}
                </>
              ) : null}
              <MotorFeedbackRow
                label="运行状态"
                value={runningState}
                tone={actualPower > 0 ? "good" : actualPower < 0 ? "warn" : "normal"}
              />
            </div>
          </>
        ) : null}
        {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
      </div>
    </section>
  );
}

function RuntimeProtectionNotice({
  online,
  runtimeLockout,
  cooldownRemainingMs,
  runActive,
  runRemainingMs,
  cyclePhase,
  cycleRunMs,
  dutyRunMs,
  roundTripCount,
  roundTripLimit,
  runningLabel,
}: {
  online: boolean;
  runtimeLockout: boolean;
  cooldownRemainingMs: number;
  runActive: boolean;
  runRemainingMs: number;
  cyclePhase: NonNullable<PropulsionDevice["cycle_phase"]>;
  cycleRunMs: number;
  dutyRunMs: number;
  roundTripCount: number;
  roundTripLimit: number;
  runningLabel: string;
}) {
  if (!online) {
    return null;
  }

  if (runtimeLockout) {
    return (
      <div className="mt-5 rounded-2xl border border-sand-500/20 bg-sand-100 px-4 py-3 text-sand-500">
        <p className="text-sm font-semibold">等待点击停止</p>
        <p className="mt-1 text-xs leading-5 text-sand-500/80">
          固件已安全停止，请点击中间的“停止”按钮解除锁定。
          {cooldownRemainingMs > 0 ? ` 剩余冷却时间 ${formatDuration(cooldownRemainingMs)}。` : ""}
        </p>
      </div>
    );
  }

  if (cooldownRemainingMs > 0) {
    return (
      <div className="mt-5 rounded-2xl border border-sand-500/20 bg-sand-100 px-4 py-3 text-sand-500">
        <p className="text-sm font-semibold">
          剩余冷却时间 <span className="tabular-nums">{formatDuration(cooldownRemainingMs)}</span>
        </p>
        <p className="mt-1 text-xs leading-5 text-sand-500/80">
          已达到 {roundTripLimit} 次完整往返或累计运行 02:00；冷却结束前，伸出和收回暂不可用。
        </p>
      </div>
    );
  }

  if (cyclePhase === "awaiting_return") {
    return (
      <div className="mt-5 rounded-2xl border border-sage-500/20 bg-sage-100 px-4 py-3 text-sage-500">
        <p className="text-sm font-semibold">第一段完成，可以立即反向</p>
        <p className="mt-1 text-xs leading-5 text-sage-500/80">
          点击与上一段相反的方向完成本次往返。当前累计 {roundTripCount}/{roundTripLimit} 次；达到 {roundTripLimit} 次或总运行 02:00 后冷却。
        </p>
      </div>
    );
  }

  if (runActive) {
    return (
      <div className="mt-5 rounded-2xl border border-harbor-500/20 bg-harbor-50 px-4 py-3 text-harbor-600">
        <p className="text-sm font-semibold">
          {cyclePhase === "returning" ? "反向行程" : "第一段"}：{runningLabel}中 · 等待点击停止
        </p>
        <p className="mt-1 text-xs leading-5 text-harbor-600/80">
          本次剩余可运行时间{" "}
          <span className="font-semibold tabular-nums">{formatDuration(runRemainingMs)}</span>
          <span> · 往返累计 {formatDuration(cycleRunMs)}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-2xl border border-sage-500/20 bg-sage-100 px-4 py-3 text-sage-500">
      <p className="text-sm font-semibold">可以启动</p>
      <p className="mt-1 text-xs leading-5 text-sage-500/80">
        已完成 {roundTripCount}/{roundTripLimit} 次往返，累计运行 {formatDuration(dutyRunMs)}；达到 {roundTripLimit} 次或 02:00 后冷却 18:00。
      </p>
    </div>
  );
}

function cyclePhaseLabel(phase: NonNullable<PropulsionDevice["cycle_phase"]>) {
  if (phase === "first_leg") return "第一段运行中";
  if (phase === "awaiting_return") return "等待反向行程";
  if (phase === "returning") return "反向行程中";
  if (phase === "cooling") return "往返完成，冷却中";
  return "等待开始";
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function MotorStateMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-app-subtle px-2.5 py-3 text-center">
      <span className="block text-[10px] font-semibold text-ink-500">{label}</span>
      <strong className="mt-1 block truncate text-xs font-semibold tabular-nums text-ink-900" title={value}>
        {value}
      </strong>
    </div>
  );
}

function MotorFeedbackRow({
  label,
  value,
  muted = false,
  tone = "normal",
}: {
  label: string;
  value: string;
  muted?: boolean;
  tone?: "normal" | "good" | "warn";
}) {
  const valueClass = muted
    ? "text-ink-500"
    : tone === "good"
      ? "text-sage-500"
      : tone === "warn"
        ? "text-sand-500"
        : "text-ink-900";

  return (
    <div className="flex items-center justify-between gap-4 py-3 text-sm">
      <span className="text-ink-500">{label}</span>
      <strong className={`text-right font-semibold tabular-nums ${valueClass}`}>{value}</strong>
    </div>
  );
}
