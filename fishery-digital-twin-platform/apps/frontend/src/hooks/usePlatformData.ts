"use client";

import { useSyncExternalStore } from "react";
import { platformStore } from "@/lib/platformStore";

// Backed by a single shared client store so every module (shell, twin, water,
// health, ...) reads the exact same live snapshot and stays in sync. The
// intervalMs argument is retained for backward compatibility but the cadence is
// now governed centrally by the store (see platformStore.ts).
export function usePlatformData(_intervalMs = 5000) {
  const data = useSyncExternalStore(platformStore.subscribe, platformStore.getSnapshot, platformStore.getSnapshot);
  return {
    snapshot: data.snapshot,
    updatedAt: data.snapshotAt ? new Date(data.snapshotAt) : null,
    loading: data.snapshotAt === null,
  };
}
