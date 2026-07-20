import { randomUUID } from "node:crypto";
import type { PropulsionCommand, PropulsionDevice, PropulsionMode, PropulsionSnapshot } from "@fishery/shared";

const DEFAULT_PROPULSION_DEVICE_ID = "mks-foc-dual-01";
const DEFAULT_MAX_POWER = 35;
const COMMAND_TIMEOUT_MS = 1_000;

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
  return Math.round(clamp(number, 10, 100));
}

function readMode(value: unknown, fallback: PropulsionMode): PropulsionMode {
  return value === "MANUAL" || value === "WEB" || value === "AUTO" ? value : fallback;
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
  return {
    device_id: deviceId,
    device_name: "MKS ESP32 FOC 双路推进板",
    mode: "MANUAL",
    enabled: false,
    emergency_stop: false,
    rc_online: true,
    auto_online: false,
    target: {
      throttle: 0,
      steering: 0,
      left_power: 0,
      right_power: 0,
      max_power: DEFAULT_MAX_POWER,
      updated_at: null,
    },
    actual_left_power: 0,
    actual_right_power: 0,
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
  getPropulsionDevice(DEFAULT_PROPULSION_DEVICE_ID);

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
  const maxPower = readMaxPower(payload.max_power ?? payload.maxPower, device.target.max_power);
  const throttle = readPercent(payload.throttle, device.target.throttle);
  const steering = readPercent(payload.steering, device.target.steering);
  const enabled = Boolean(payload.enabled);
  const emergencyStop = Boolean(payload.emergency_stop ?? payload.emergencyStop);
  const active = mode === "WEB" && enabled && !emergencyStop;
  const output = mixPropulsion(throttle, steering, maxPower, active);
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
  device.actual_left_power = output.left;
  device.actual_right_power = output.right;
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
  device.last_seen = nowIso();

  return {
    device: deviceSnapshot(deviceId),
    propulsion: getPropulsionSnapshot() as PropulsionSnapshot,
  };
}

export function takePropulsionCommands(deviceId = DEFAULT_PROPULSION_DEVICE_ID) {
  getPropulsionDevice(deviceId);
  const commands = commandQueues.get(deviceId) || [];
  commandQueues.set(deviceId, []);
  return commands;
}
