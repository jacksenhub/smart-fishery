"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CircleStop, Link2, ShieldAlert } from "lucide-react";
import type { PropulsionDevice } from "@fishery/shared";
import { setPropulsionTarget } from "@/lib/api";
import { platformStore } from "@/lib/platformStore";

const DEVICE_ID = "maker-esp32-pro-linear-02";
const MAX_POWER = 100;
const DEFAULT_POWER = 50;
const DIRECTION_MULTIPLIER: [1 | -1, 1 | -1] = [-1, -1];

type DualPower = [number, number];

export function DualLinearActuatorCard({
  device,
  embedded = false,
}: {
  device?: PropulsionDevice;
  embedded?: boolean;
}) {
  const [power, setPower] = useState(DEFAULT_POWER);
  const [individualPowers, setIndividualPowers] = useState<DualPower>([
    DEFAULT_POWER,
    DEFAULT_POWER,
  ]);
  const [targets, setTargets] = useState<DualPower>([0, 0]);
  const [error, setError] = useState<string | null>(null);
  const targetsRef = useRef<DualPower>([0, 0]);
  const actualPower: DualPower = [
    device?.actual_left_power ?? 0,
    device?.actual_right_power ?? 0,
  ];
  const logicalTargets: DualPower = [
    targets[0] * DIRECTION_MULTIPLIER[0],
    targets[1] * DIRECTION_MULTIPLIER[1],
  ];
  const synchronizedDirection = logicalTargets.every((value) => value > 0)
    ? 1
    : logicalTargets.every((value) => value < 0)
      ? -1
      : 0;

  const sendCommand = useCallback(async (
    nextTargets: DualPower,
    emergencyStop = false,
    updateUi = true,
  ) => {
    if (updateUi) setError(null);

    const enabled = !emergencyStop && nextTargets.some((value) => value !== 0);
    const throttle = Math.round((nextTargets[0] + nextTargets[1]) / 2);
    const steering = Math.round((nextTargets[0] - nextTargets[1]) / 2);

    try {
      const result = await setPropulsionTarget({
        device_id: DEVICE_ID,
        mode: "WEB",
        enabled,
        emergency_stop: emergencyStop,
        throttle,
        steering,
        left_power: nextTargets[0],
        right_power: nextTargets[1],
        max_power: MAX_POWER,
      });
      platformStore.applyFeedback({ propulsion: result.propulsion });
    } catch (commandError) {
      if (updateUi) {
        setError(commandError instanceof Error ? commandError.message : "双推杆命令发送失败");
      }
    }
  }, []);

  useEffect(() => {
    targetsRef.current = targets;
    if (targets.every((value) => value === 0)) return;

    void sendCommand(targets, false, false);
    const timer = window.setInterval(() => {
      void sendCommand(targetsRef.current, false, false);
    }, 800);
    return () => window.clearInterval(timer);
  }, [sendCommand, targets]);

  useEffect(() => {
    if (device?.online || targets.every((value) => value === 0)) return;
    const stopped: DualPower = [0, 0];
    targetsRef.current = stopped;
    setTargets(stopped);
    void sendCommand(stopped, false, false);
  }, [device?.online, sendCommand, targets]);

  useEffect(() => () => {
    if (targetsRef.current.some((value) => value !== 0)) {
      void sendCommand([0, 0], false, false);
    }
  }, [sendCommand]);

  function requireOnline() {
    if (device?.online) return true;
    setError("ESP32 开发板 1 未在线");
    return false;
  }

  function startBoth(direction: 1 | -1) {
    if (!requireOnline()) return;
    const next: DualPower = [
      direction * power * DIRECTION_MULTIPLIER[0],
      direction * power * DIRECTION_MULTIPLIER[1],
    ];
    targetsRef.current = next;
    setTargets(next);
    setError(null);
  }

  function stopBoth() {
    const stopped: DualPower = [0, 0];
    targetsRef.current = stopped;
    setTargets(stopped);
    void sendCommand(stopped);
  }

  function startOne(channelIndex: 0 | 1, direction: 1 | -1) {
    if (!requireOnline()) return;
    const next: DualPower = [...targetsRef.current];
    next[channelIndex] = direction
      * individualPowers[channelIndex]
      * DIRECTION_MULTIPLIER[channelIndex];
    targetsRef.current = next;
    setTargets(next);
    setError(null);
  }

  function stopOne(channelIndex: 0 | 1) {
    const next: DualPower = [...targetsRef.current];
    next[channelIndex] = 0;
    targetsRef.current = next;
    setTargets(next);
    void sendCommand(next);
  }

  function emergencyStopBoth() {
    const stopped: DualPower = [0, 0];
    targetsRef.current = stopped;
    setTargets(stopped);
    void sendCommand(stopped, true);
  }

  function updateSynchronizedPower(nextPower: number) {
    setPower(nextPower);

    const currentDirection = Math.sign(
      targetsRef.current[0] * DIRECTION_MULTIPLIER[0],
    ) as -1 | 0 | 1;
    if (currentDirection === 0) return;

    const nextTargets: DualPower = [
      currentDirection * nextPower * DIRECTION_MULTIPLIER[0],
      currentDirection * nextPower * DIRECTION_MULTIPLIER[1],
    ];
    targetsRef.current = nextTargets;
    setTargets(nextTargets);
  }

  function updateIndividualPower(channelIndex: 0 | 1, nextPower: number) {
    setIndividualPowers((current) => {
      const next: DualPower = [...current];
      next[channelIndex] = nextPower;
      return next;
    });

    const logicalDirection = Math.sign(
      targetsRef.current[channelIndex] * DIRECTION_MULTIPLIER[channelIndex],
    ) as -1 | 0 | 1;
    if (logicalDirection === 0) return;

    const nextTargets: DualPower = [...targetsRef.current];
    nextTargets[channelIndex] = logicalDirection
      * nextPower
      * DIRECTION_MULTIPLIER[channelIndex];
    targetsRef.current = nextTargets;
    setTargets(nextTargets);
  }

  return (
    <section className={embedded
      ? "h-full min-w-0 bg-transparent"
      : "overflow-hidden rounded-[26px] border border-app-line bg-white shadow-soft"
    }>
      <div className="flex h-full flex-col p-5 md:p-6">
        <div className="flex flex-col gap-3 border-b border-app-line pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-harbor-600">ESP32 开发板 1</p>
            <h2 className="mt-1 text-xl font-semibold text-ink-900">双路 12V 推杆执行器</h2>
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

        <div className="mt-6 flex items-center justify-between gap-4">
          <label htmlFor="dual-linear-power" className="flex items-center gap-2 text-sm font-semibold text-ink-700">
              <Link2 className="h-4 w-4" />
            同步目标功率
          </label>
          <span className="text-3xl font-semibold tabular-nums text-harbor-600">
            <span className="mr-2 text-base">两路各</span>{power}%
          </span>
        </div>
        <input
          id="dual-linear-power"
          type="range"
          min={5}
          max={MAX_POWER}
          step={1}
          value={power}
          onChange={(event) => updateSynchronizedPower(Number(event.target.value))}
          className="servo-range mt-6 w-full"
        />
        <div className="mt-2 flex justify-between text-xs font-semibold text-ink-500">
          <span>5%</span>
          <span>同步上限 {MAX_POWER}%</span>
        </div>

        <div className="mt-7 grid grid-cols-3 gap-3">
          <SyncButton label="同步伸出" icon={ArrowUp} onClick={() => startBoth(1)} disabled={!device?.online} active={synchronizedDirection > 0} tone="positive" />
          <SyncButton label="全部停止" icon={CircleStop} onClick={stopBoth} disabled={!device?.online} active={synchronizedDirection === 0} tone="stop" />
          <SyncButton label="同步缩回" icon={ArrowDown} onClick={() => startBoth(-1)} disabled={!device?.online} active={synchronizedDirection < 0} tone="negative" />
        </div>

        <div className="mt-6 border-t border-app-line pt-5">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="rounded-full border border-app-line bg-app-subtle px-3 py-1 text-[11px] font-semibold text-ink-500">
              M1 / M2 独立 PWM
            </span>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {([0, 1] as const).map((channelIndex) => {
              const logicalDirection = Math.sign(logicalTargets[channelIndex]);
              const channelLabel = channelIndex === 0 ? "推杆 1" : "推杆 2";
              const portLabel = channelIndex === 0 ? "M1" : "M2";
              const sliderId = `dual-linear-channel-${channelIndex + 1}-power`;

              return (
                <div key={portLabel} className="rounded-2xl border border-app-line bg-app-subtle/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-base font-semibold text-ink-900">{channelLabel}</h4>
                      <p className="mt-0.5 text-xs font-semibold text-ink-500">{portLabel} 独立输出</p>
                    </div>
                    <strong className="text-xl font-semibold tabular-nums text-harbor-600">
                      {individualPowers[channelIndex]}%
                    </strong>
                  </div>

                  <label htmlFor={sliderId} className="sr-only">{channelLabel}目标功率</label>
                  <input
                    id={sliderId}
                    type="range"
                    min={5}
                    max={MAX_POWER}
                    step={1}
                    value={individualPowers[channelIndex]}
                    onChange={(event) => updateIndividualPower(channelIndex, Number(event.target.value))}
                    className="servo-range mt-4 w-full"
                  />

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <SyncButton
                      label="伸出"
                      icon={ArrowUp}
                      onClick={() => startOne(channelIndex, 1)}
                      disabled={!device?.online}
                      active={logicalDirection > 0}
                      tone="positive"
                    />
                    <SyncButton
                      label="停止"
                      icon={CircleStop}
                      onClick={() => stopOne(channelIndex)}
                      disabled={!device?.online}
                      active={logicalDirection === 0}
                      tone="stop"
                    />
                    <SyncButton
                      label="缩回"
                      icon={ArrowDown}
                      onClick={() => startOne(channelIndex, -1)}
                      disabled={!device?.online}
                      active={logicalDirection < 0}
                      tone="negative"
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-app-line pt-3 text-xs font-semibold text-ink-500">
                    板端 PWM
                    <strong className="tabular-nums text-ink-900">
                      {actualPower[channelIndex] > 0 ? "+" : ""}{actualPower[channelIndex]}%
                    </strong>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={emergencyStopBoth}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-100"
        >
          <ShieldAlert size={17} aria-hidden="true" />
          双推杆紧急停止
        </button>

        <div className="mt-4 grid grid-cols-2 gap-5 rounded-2xl border border-app-line bg-app-subtle px-4 py-3 text-xs font-semibold">
          <span className="flex items-center justify-between gap-2 text-ink-500">
            M1 板端 PWM
            <strong className="tabular-nums text-ink-900">{actualPower[0] > 0 ? "+" : ""}{actualPower[0]}%</strong>
          </span>
          <span className="flex items-center justify-between gap-2 text-ink-500">
            M2 板端 PWM
            <strong className="tabular-nums text-ink-900">{actualPower[1] > 0 ? "+" : ""}{actualPower[1]}%</strong>
          </span>
        </div>

        {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
      </div>
    </section>
  );
}

function SyncButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  active,
  tone,
}: {
  label: string;
  icon: typeof ArrowUp;
  onClick: () => void;
  disabled: boolean;
  active: boolean;
  tone: "positive" | "negative" | "stop";
}) {
  const toneClass = tone === "positive"
    ? "border-sage-500/25 bg-sage-100 text-sage-500 hover:border-sage-500/40"
    : tone === "negative"
      ? "border-sand-500/25 bg-sand-100 text-sand-500 hover:border-sand-500/40"
      : "border-app-line bg-white text-ink-700 hover:border-harbor-500/45 hover:text-harbor-600";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? "ring-2 ring-harbor-500/45" : ""} ${toneClass}`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
