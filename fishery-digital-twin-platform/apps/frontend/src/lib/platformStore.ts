"use client";

import type { PlatformSnapshot, PropulsionSnapshot, ServoSnapshot } from "@fishery/shared";
import { getPlatformSnapshot, getPropulsionSnapshot, getServoSnapshot } from "@/lib/api";
import { createSnapshot } from "@/lib/fallback-data";

export type PlatformStoreState = {
  snapshot: PlatformSnapshot;
  servos: ServoSnapshot | null;
  propulsion: PropulsionSnapshot | null;
  snapshotAt: number | null;
  feedbackAt: number | null;
  snapshotConnected: boolean;
  feedbackConnected: boolean;
};

export type PlatformDataSlice = Pick<PlatformStoreState, "snapshot" | "snapshotAt" | "snapshotConnected">;
export type DeviceFeedbackSlice = Pick<PlatformStoreState, "servos" | "propulsion" | "feedbackAt" | "feedbackConnected">;

const SNAPSHOT_INTERVAL = 2000;
const FEEDBACK_INTERVAL = 1000;

// Deterministic initial snapshot (no Date.now), shared by server and client
// so useSyncExternalStore never triggers a hydration mismatch.
const initialSnapshot = createSnapshot();

let state: PlatformStoreState = {
  snapshot: initialSnapshot,
  servos: null,
  propulsion: null,
  snapshotAt: null,
  feedbackAt: null,
  snapshotConnected: false,
  feedbackConnected: false,
};

// React uses these immutable snapshots for both the server render and the
// client's first hydration pass. The live store may already contain newer data
// after an in-app navigation or Fast Refresh, so it must not be used as the
// server snapshot.
const serverPlatformDataSlice: PlatformDataSlice = {
  snapshot: initialSnapshot,
  snapshotAt: null,
  snapshotConnected: false,
};
const serverDeviceFeedbackSlice: DeviceFeedbackSlice = {
  servos: null,
  propulsion: null,
  feedbackAt: null,
  feedbackConnected: false,
};

// These stable slice objects are replaced only when their own data changes.
// useSyncExternalStore compares snapshots with Object.is, so a 1-second device
// feedback update no longer re-renders snapshot-only pages and the shell.
let platformDataSlice: PlatformDataSlice = serverPlatformDataSlice;
let deviceFeedbackSlice: DeviceFeedbackSlice = serverDeviceFeedbackSlice;

const listeners = new Set<() => void>();
let started = false;
let snapshotTimer: number | null = null;
let feedbackTimer: number | null = null;
let refCount = 0;
let snapshotRefreshPromise: Promise<boolean> | null = null;
let feedbackRefreshPromise: Promise<void> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function setSnapshot(next: PlatformSnapshot) {
  state = { ...state, snapshot: next, snapshotAt: Date.now(), snapshotConnected: true };
  platformDataSlice = {
    snapshot: state.snapshot,
    snapshotAt: state.snapshotAt,
    snapshotConnected: state.snapshotConnected,
  };
  emit();
}

function setFeedback(servos: ServoSnapshot | null, propulsion: PropulsionSnapshot | null, connected: boolean) {
  state = {
    ...state,
    servos: servos ?? state.servos,
    propulsion: propulsion ?? state.propulsion,
    feedbackAt: connected ? Date.now() : state.feedbackAt,
    feedbackConnected: connected,
  };
  deviceFeedbackSlice = {
    servos: state.servos,
    propulsion: state.propulsion,
    feedbackAt: state.feedbackAt,
    feedbackConnected: state.feedbackConnected,
  };
  emit();
}

function refreshSnapshot() {
  if (snapshotRefreshPromise) return snapshotRefreshPromise;
  snapshotRefreshPromise = (async () => {
    try {
      setSnapshot(await getPlatformSnapshot());
      return true;
    } catch {
      state = { ...state, snapshotConnected: false };
      platformDataSlice = { ...platformDataSlice, snapshotConnected: false };
      emit();
      return false;
    }
  })().finally(() => {
    snapshotRefreshPromise = null;
  });
  return snapshotRefreshPromise;
}

function refreshFeedback() {
  if (feedbackRefreshPromise) return feedbackRefreshPromise;

  feedbackRefreshPromise = (async () => {
    const [servoResult, propulsionResult] = await Promise.allSettled([getServoSnapshot(), getPropulsionSnapshot()]);
    const connected = servoResult.status === "fulfilled" || propulsionResult.status === "fulfilled";
    const servos = servoResult.status === "fulfilled" ? servoResult.value : null;
    const propulsion = propulsionResult.status === "fulfilled" ? propulsionResult.value : null;
    setFeedback(servos, propulsion, connected);
  })().finally(() => {
    feedbackRefreshPromise = null;
  });

  return feedbackRefreshPromise;
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  void refreshSnapshot();
  void refreshFeedback();
  snapshotTimer = window.setInterval(refreshSnapshot, SNAPSHOT_INTERVAL);
  feedbackTimer = window.setInterval(refreshFeedback, FEEDBACK_INTERVAL);
}

function stop() {
  if (!started) return;
  started = false;
  if (snapshotTimer) window.clearInterval(snapshotTimer);
  if (feedbackTimer) window.clearInterval(feedbackTimer);
  snapshotTimer = null;
  feedbackTimer = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  refCount += 1;
  start();
  return () => {
    listeners.delete(listener);
    refCount -= 1;
    if (refCount <= 0) stop();
  };
}

function getSnapshot() {
  return state;
}

function getPlatformDataSlice() {
  return platformDataSlice;
}

function getServerPlatformDataSlice() {
  return serverPlatformDataSlice;
}

function getDeviceFeedbackSlice() {
  return deviceFeedbackSlice;
}

function getServerDeviceFeedbackSlice() {
  return serverDeviceFeedbackSlice;
}

function applyFeedback(update: { servos?: ServoSnapshot; propulsion?: PropulsionSnapshot }) {
  setFeedback(update.servos ?? null, update.propulsion ?? null, true);
}

export const platformStore = {
  subscribe,
  getSnapshot,
  getPlatformDataSlice,
  getServerPlatformDataSlice,
  getDeviceFeedbackSlice,
  getServerDeviceFeedbackSlice,
  refreshSnapshot,
  refreshFeedback,
  applyFeedback,
};
