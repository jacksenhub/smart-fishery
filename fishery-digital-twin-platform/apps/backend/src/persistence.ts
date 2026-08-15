import fs from "node:fs";
import path from "node:path";
import type { AIReport, BatteryData, SystemLog, WaterData } from "@fishery/shared";

export interface PersistedPlatformState {
  waterHistory: WaterData[];
  batteries: BatteryData[];
  latestAiReport: AIReport | null;
  systemLogs: SystemLog[];
}

const dataDirectory = path.resolve(process.env.UISYS_DATA_DIR || path.join(process.cwd(), "data"));
const stateFile = path.join(dataDirectory, "platform-state.json");
let pendingState: PersistedPlatformState | null = null;
let saveTimer: NodeJS.Timeout | null = null;

function persistPendingState() {
  const next = pendingState;
  pendingState = null;
  if (!next) return;

  try {
    fs.mkdirSync(dataDirectory, { recursive: true });
    const temporaryFile = `${stateFile}.tmp`;
    fs.writeFileSync(temporaryFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryFile, stateFile);
  } catch (error) {
    console.error(`Could not persist platform state: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function loadPersistedState(): PersistedPlatformState | null {
  try {
    if (!fs.existsSync(stateFile)) return null;
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Partial<PersistedPlatformState>;
    if (!Array.isArray(parsed.waterHistory) || !Array.isArray(parsed.batteries) || !Array.isArray(parsed.systemLogs)) {
      throw new Error("persisted state has an invalid shape");
    }
    return {
      waterHistory: parsed.waterHistory.slice(-180),
      batteries: parsed.batteries,
      latestAiReport: parsed.latestAiReport ?? null,
      systemLogs: parsed.systemLogs.slice(0, 80),
    };
  } catch (error) {
    console.error(`Could not load persisted platform state: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function schedulePersistState(state: PersistedPlatformState) {
  pendingState = state;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistPendingState();
  }, 250);
  saveTimer.unref();
}

export function flushPersistedState() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  persistPendingState();
}
