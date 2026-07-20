import { randomUUID } from "node:crypto";
import type { ServoCommand, ServoDevice, ServoSnapshot } from "@fishery/shared";

const SERVO_CHANNEL_COUNT = 4;
const DEFAULT_SERVO_DEVICE_IDS = ["servo-quad-01", "servo-quad-02"];

type ServoState = Omit<ServoDevice, "online">;

const servoDevices = new Map<string, ServoState>();
const commandQueues = new Map<string, ServoCommand[]>();

function nowIso() {
  return new Date().toISOString();
}

function createServoDevice(deviceId: string): ServoState {
  const presetIndex = DEFAULT_SERVO_DEVICE_IDS.indexOf(deviceId);
  return {
    device_id: deviceId,
    device_name: presetIndex >= 0 ? `舵机控制板 ${presetIndex + 1}` : deviceId,
    target_angles: [90, 90, 90, 90],
    actual_angles: [null, null, null, null],
    last_seen: null,
    updated_at: null,
  };
}

function getServoDevice(deviceId = DEFAULT_SERVO_DEVICE_IDS[0]) {
  if (!servoDevices.has(deviceId)) {
    servoDevices.set(deviceId, createServoDevice(deviceId));
  }
  return servoDevices.get(deviceId)!;
}

function isOnline(lastSeen: string | null) {
  if (!lastSeen) return false;
  const time = new Date(lastSeen).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= 10_000;
}

function deviceSnapshot(deviceId: string): ServoDevice {
  const state = getServoDevice(deviceId);
  return {
    ...state,
    target_angles: [...state.target_angles],
    actual_angles: [...state.actual_angles],
    online: isOnline(state.last_seen),
  };
}

function parseAngle(value: unknown) {
  const angle = Number(value);
  if (!Number.isFinite(angle)) return null;
  const rounded = Math.round(angle);
  if (rounded < 0 || rounded > 180) return null;
  return rounded;
}

function parseAngles(values: unknown) {
  if (!Array.isArray(values) || values.length !== SERVO_CHANNEL_COUNT) return null;
  const angles = values.map(parseAngle);
  if (angles.some((angle) => angle === null)) return null;
  return angles as number[];
}

export function getServoSnapshot(deviceId?: string): ServoSnapshot | ServoDevice {
  DEFAULT_SERVO_DEVICE_IDS.forEach((id) => getServoDevice(id));

  if (deviceId) {
    return deviceSnapshot(deviceId);
  }

  const devices = [...servoDevices.keys()].sort().map(deviceSnapshot);
  const onlineCount = devices.filter((device) => device.online).length;
  return {
    devices,
    device_count: devices.length,
    online_count: onlineCount,
    online: onlineCount > 0,
  };
}

export function setServoTargets(payload: Record<string, unknown>) {
  const deviceId = String(payload.device_id || DEFAULT_SERVO_DEVICE_IDS[0]);
  const device = getServoDevice(deviceId);
  let nextAngles = [...device.target_angles];

  if ("angles" in payload) {
    const parsed = parseAngles(payload.angles);
    if (!parsed) {
      throw new Error("angles must contain four numbers from 0 to 180");
    }
    nextAngles = parsed;
  } else if ("channel" in payload && "angle" in payload) {
    const channel = Number(payload.channel);
    const angle = parseAngle(payload.angle);
    if (!Number.isInteger(channel) || channel < 1 || channel > SERVO_CHANNEL_COUNT || angle === null) {
      throw new Error("channel must be 1-4 and angle must be 0-180");
    }
    nextAngles[channel - 1] = angle;
  } else {
    throw new Error("provide angles or channel and angle");
  }

  device.target_angles = nextAngles;
  device.updated_at = nowIso();

  const command: ServoCommand = {
    id: randomUUID(),
    type: "servo4",
    device_id: deviceId,
    angles: [...nextAngles],
    created_at: nowIso(),
  };

  commandQueues.set(deviceId, [command]);

  return {
    command,
    device: deviceSnapshot(deviceId),
    servos: getServoSnapshot() as ServoSnapshot,
  };
}

export function updateServoStatus(payload: Record<string, unknown>) {
  const angles = parseAngles(payload.angles);
  if (!angles) {
    throw new Error("angles must contain four numbers from 0 to 180");
  }

  const deviceId = String(payload.device_id || DEFAULT_SERVO_DEVICE_IDS[0]);
  const device = getServoDevice(deviceId);
  if (payload.device_name) {
    device.device_name = String(payload.device_name);
  }
  device.actual_angles = angles;
  device.last_seen = nowIso();

  return {
    device: deviceSnapshot(deviceId),
    servos: getServoSnapshot() as ServoSnapshot,
  };
}

export function takeServoCommands(deviceId = DEFAULT_SERVO_DEVICE_IDS[0]) {
  getServoDevice(deviceId);
  const commands = commandQueues.get(deviceId) || [];
  commandQueues.set(deviceId, []);
  return commands;
}

