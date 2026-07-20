import type { AIReport, PlatformSnapshot, PropulsionMode, PropulsionSnapshot, ServoSnapshot, SystemLog, TwinSimulationInput, TwinSimulationResult } from "@fishery/shared";
import { createSnapshot } from "./fallback-data";

const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5000";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `API returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function getPlatformSnapshot(): Promise<PlatformSnapshot> {
  try {
    return await fetchJson<PlatformSnapshot>("/api/snapshot");
  } catch {
    return createSnapshot(Date.now());
  }
}

export async function generateSimulation(count = 96) {
  return fetchJson<{ count: number; snapshot: PlatformSnapshot; log: SystemLog }>("/api/simulate", {
    method: "POST",
    body: JSON.stringify({ count }),
  });
}

export async function getAiStatus() {
  return fetchJson<{ configured: boolean; model: string; hasReport: boolean }>("/api/ai/status");
}

export async function getAiReport() {
  return fetchJson<AIReport>("/api/ai/report");
}

export async function generateAiReport() {
  return fetchJson<{ report: AIReport; log: SystemLog }>("/api/ai/report", {
    method: "POST",
    body: "{}",
  });
}

export async function getServoSnapshot() {
  return fetchJson<ServoSnapshot>("/api/servos");
}

export async function setServoChannel(deviceId: string, channel: number, angle: number) {
  return fetchJson<{ servos: ServoSnapshot }>("/api/servos", {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId, channel, angle }),
  });
}

export async function setServoAngles(deviceId: string, angles: number[]) {
  return fetchJson<{ servos: ServoSnapshot }>("/api/servos", {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId, angles }),
  });
}

export async function getPropulsionSnapshot() {
  return fetchJson<PropulsionSnapshot>("/api/propulsion");
}

export async function setPropulsionTarget(payload: {
  device_id?: string;
  mode: PropulsionMode;
  enabled: boolean;
  emergency_stop: boolean;
  throttle: number;
  steering: number;
  max_power: number;
}) {
  return fetchJson<{ propulsion: PropulsionSnapshot }>("/api/propulsion", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getSystemLogs() {
  return fetchJson<SystemLog[]>("/api/logs");
}

export async function runTwinPrediction(input: TwinSimulationInput) {
  return fetchJson<TwinSimulationResult>("/api/twin/simulate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
