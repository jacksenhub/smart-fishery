import { randomUUID } from "node:crypto";
import type { PropulsionCommand, PropulsionDevice, PropulsionMode, PropulsionSnapshot } from "@fishery/shared";

const DEFAULT_PROPULSION_DEVICE_ID = "maker-esp32-pro-dc-01";
const DEFAULT_MAX_POWER = 35;
const COMMAND_TIMEOUT_MS = 2_500;
const CONFIGURED_PROPULSION_DEVICES = [
  {
    deviceId: "maker-esp32-pro-dc-01",
    deviceName: "12V 37GB555 驱动电机",
    maxPower: 100,
    singleChannel: true,
  },
  {
    deviceId: "maker-esp32-pro-linear-01-m1",
    deviceName: "12V SXTL 电动推杆",
    maxPower: 100,
    singleChannel: true,
  },
  {
    deviceId: "maker-esp32-pro-linear-02",
    deviceName: "开发板 1 双路 12V 推杆执行器",
    maxPower: 100,
    singleChannel: false,
  },
] as const;

type PropulsionState = Omit<PropulsionDevice, "online" | "web_online">;

const propulsionDevices = new Map<string, PropulsionState>();
const commandQueues = new Map<string, PropulsionCommand[]>();

function nowIso() {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function readPercent(value: unknown, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(clamp(number, -100, 100));
}

function readMaxPower(value: unknown, fallback = DEFAULT_MAX_POWER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(clamp(number, 5, 100));
}

function readNonNegativeMilliseconds(value: unknown, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
}

function readNonNegativeInteger(value: unknown, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
}

function readMode(value: unknown, fallback: PropulsionMode): PropulsionMode {
  return value === "MANUAL" || value === "WEB" || value === "AUTO" ? value : fallback;
}

function readCyclePhase(
  value: unknown,
  fallback: NonNullable<PropulsionDevice["cycle_phase"]>,
) {
  return value === "idle"
    || value === "first_leg"
    || value === "awaiting_return"
    || value === "returning"
    || value === "cooling"
    ? value
    : fallback;
}

function isFresh(timestamp: string | null, maxAgeMs: number) {
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= maxAgeMs;
}

function mixPropulsion(throttle: number, steering: number, maxPower: number, active: boolean) {
  if (!active) return { left: 0, right: 0 };
  return {
    left: clamp(throttle + steering, -maxPower, maxPower),
    right: clamp(throttle - steering, -maxPower, maxPower),
  };
}

function createPropulsionDevice(deviceId: string): PropulsionState {
  const config = CONFIGURED_PROPULSION_DEVICES.find((item) => item.deviceId === deviceId);
  return {
    device_id: deviceId,
    device_name: config?.deviceName ?? deviceId,
    mode: "MANUAL",
    enabled: false,
    emergency_stop: false,
    rc_online: false,
    auto_online: false,
    target: {
      throttle: 0,
      steering: 0,
      left_power: 0,
      right_power: 0,
      max_power: config?.maxPower ?? DEFAULT_MAX_POWER,
      updated_at: null,
    },
    actual_left_power: 0,
    actual_right_power: 0,
    runtime_lockout: false,
    cooldown_remaining_ms: 0,
    run_active: false,
    run_remaining_ms: 0,
    cycle_phase: "idle",
    cycle_run_ms: 0,
    duty_run_ms: 0,
    duty_remaining_ms: 120_000,
    round_trip_count: 0,
    round_trip_limit: 4,
    last_seen: null,
    updated_at: null,
  };
}

function getPropulsionDevice(deviceId = DEFAULT_PROPULSION_DEVICE_ID) {
  if (!propulsionDevices.has(deviceId)) {
    propulsionDevices.set(deviceId, createPropulsionDevice(deviceId));
  }
  return propulsionDevices.get(deviceId)!;
}

function deviceSnapshot(deviceId: string): PropulsionDevice {
  const state = getPropulsionDevice(deviceId);
  return {
    ...state,
    target: { ...state.target },
    web_online: isFresh(state.target.updated_at, COMMAND_TIMEOUT_MS),
    online: isFresh(state.last_seen, 10_000),
  };
}

export function getPropulsionSnapshot(deviceId?: string): PropulsionSnapshot | PropulsionDevice {
  CONFIGURED_PROPULSION_DEVICES.forEach((config) => getPropulsionDevice(config.deviceId));

  if (deviceId) {
    return deviceSnapshot(deviceId);
  }

  const devices = [...propulsionDevices.keys()].sort().map(deviceSnapshot);
  const onlineCount = devices.filter((device) => device.online).length;
  return {
    devices,
    device_count: devices.length,
    online_count: onlineCount,
    online: onlineCount > 0,
  };
}

export function setPropulsionTarget(payload: Record<string, unknown>) {
  const deviceId = String(payload.device_id || DEFAULT_PROPULSION_DEVICE_ID);
  const device = getPropulsionDevice(deviceId);
  const mode = readMode(payload.mode, device.mode);
  const config = CONFIGURED_PROPULSION_DEVICES.find((item) => item.deviceId === deviceId);
  const requestedMaxPower = readMaxPower(payload.max_power ?? payload.maxPower, device.target.max_power);
  const maxPower = Math.min(requestedMaxPower, config?.maxPower ?? DEFAULT_MAX_POWER);
  const throttle = readPercent(payload.throttle, device.target.throttle);
  const steering = readPercent(payload.steering, device.target.steering);
  const enabled = Boolean(payload.enabled);
  const emergencyStop = Boolean(payload.emergency_stop ?? payload.emergencyStop);
  const active = mode === "WEB" && enabled && !emergencyStop;
  if (active && !isFresh(device.last_seen, 10_000)) {
    throw new Error(`propulsion device ${deviceId} is offline; active command was not queued`);
  }
  const hasDirectChannelPower = payload.left_power !== undefined || payload.right_power !== undefined;
  const directLeftPower = readPercent(payload.left_power, device.target.left_power);
  const directRightPower = readPercent(payload.right_power, device.target.right_power);
  const output = !active
    ? { left: 0, right: 0 }
    : config?.singleChannel
      ? { left: clamp(throttle, -maxPower, maxPower), right: 0 }
      : hasDirectChannelPower
        ? {
            left: clamp(directLeftPower, -maxPower, maxPower),
            right: clamp(directRightPower, -maxPower, maxPower),
          }
        : mixPropulsion(throttle, steering, maxPower, true);
  const updatedAt = nowIso();

  device.mode = mode;
  device.enabled = enabled;
  device.emergency_stop = emergencyStop;
  device.target = {
    throttle,
    steering,
    left_power: output.left,
    right_power: output.right,
    max_power: maxPower,
    updated_at: updatedAt,
  };
  device.updated_at = updatedAt;

  const command: PropulsionCommand = {
    id: randomUUID(),
    type: "propulsion2",
    device_id: deviceId,
    mode,
    enabled,
    emergency_stop: emergencyStop,
    throttle,
    steering,
    left_power: output.left,
    right_power: output.right,
    max_power: maxPower,
    created_at: updatedAt,
  };

  commandQueues.set(deviceId, [command]);

  return {
    command,
    device: deviceSnapshot(deviceId),
    propulsion: getPropulsionSnapshot() as PropulsionSnapshot,
  };
}

export function updatePropulsionStatus(payload: Record<string, unknown>) {
  const deviceId = String(payload.device_id || DEFAULT_PROPULSION_DEVICE_ID);
  const device = getPropulsionDevice(deviceId);

  if (payload.device_name) {
    device.device_name = String(payload.device_name);
  }

  device.mode = readMode(payload.mode, device.mode);
  device.enabled = Boolean(payload.enabled ?? device.enabled);
  device.emergency_stop = Boolean(payload.emergency_stop ?? payload.emergencyStop ?? device.emergency_stop);
  device.rc_online = Boolean(payload.rc_online ?? payload.rcOnline ?? device.rc_online);
  device.auto_online = Boolean(payload.auto_online ?? payload.autoOnline ?? device.auto_online);
  device.actual_left_power = readPercent(payload.actual_left_power ?? payload.left_power ?? payload.leftPower, device.actual_left_power);
  device.actual_right_power = readPercent(payload.actual_right_power ?? payload.right_power ?? payload.rightPower, device.actual_right_power);
  if (payload.runtime_lockout !== undefined || payload.runtimeLockout !== undefined) {
    device.runtime_lockout = Boolean(payload.runtime_lockout ?? payload.runtimeLockout);
  }
  if (payload.cooldown_remaining_ms !== undefined || payload.cooldownRemainingMs !== undefined) {
    device.cooldown_remaining_ms = readNonNegativeMilliseconds(
      payload.cooldown_remaining_ms ?? payload.cooldownRemainingMs,
      device.cooldown_remaining_ms,
    );
  }
  if (payload.run_active !== undefined || payload.runActive !== undefined) {
    device.run_active = Boolean(payload.run_active ?? payload.runActive);
  }
  if (payload.run_remaining_ms !== undefined || payload.runRemainingMs !== undefined) {
    device.run_remaining_ms = readNonNegativeMilliseconds(
      payload.run_remaining_ms ?? payload.runRemainingMs,
      device.run_remaining_ms,
    );
  }
  if (payload.cycle_phase !== undefined || payload.cyclePhase !== undefined) {
    device.cycle_phase = readCyclePhase(
      payload.cycle_phase ?? payload.cyclePhase,
      device.cycle_phase ?? "idle",
    );
  }
  if (payload.cycle_run_ms !== undefined || payload.cycleRunMs !== undefined) {
    device.cycle_run_ms = readNonNegativeMilliseconds(
      payload.cycle_run_ms ?? payload.cycleRunMs,
      device.cycle_run_ms ?? 0,
    );
  }
  if (payload.duty_run_ms !== undefined || payload.dutyRunMs !== undefined) {
    device.duty_run_ms = readNonNegativeMilliseconds(
      payload.duty_run_ms ?? payload.dutyRunMs,
      device.duty_run_ms ?? 0,
    );
  }
  if (payload.duty_remaining_ms !== undefined || payload.dutyRemainingMs !== undefined) {
    device.duty_remaining_ms = readNonNegativeMilliseconds(
      payload.duty_remaining_ms ?? payload.dutyRemainingMs,
      device.duty_remaining_ms ?? 120_000,
    );
  }
  if (payload.round_trip_count !== undefined || payload.roundTripCount !== undefined) {
    device.round_trip_count = readNonNegativeInteger(
      payload.round_trip_count ?? payload.roundTripCount,
      device.round_trip_count ?? 0,
    );
  }
  if (payload.round_trip_limit !== undefined || payload.roundTripLimit !== undefined) {
    device.round_trip_limit = readNonNegativeInteger(
      payload.round_trip_limit ?? payload.roundTripLimit,
      device.round_trip_limit ?? 4,
    );
  }
  device.last_seen = nowIso();

  return {
    device: deviceSnapshot(deviceId),
    propulsion: getPropulsionSnapshot() as PropulsionSnapshot,
  };
}

export function takePropulsionCommands(deviceId = DEFAULT_PROPULSION_DEVICE_ID) {
  getPropulsionDevice(deviceId);
  const commands = (commandQueues.get(deviceId) || []).filter((command) => {
    const createdAt = new Date(command.created_at).getTime();
    return Number.isFinite(createdAt) && Date.now() - createdAt <= COMMAND_TIMEOUT_MS;
  });
  commandQueues.set(deviceId, commands);
  return commands;
}
