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

const SNAPSHOT_INTERVAL = 4000;
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

const listeners = new Set<() => void>();
let started = false;
let snapshotTimer: number | null = null;
let feedbackTimer: number | null = null;
let refCount = 0;

function emit() {
  for (const listener of listeners) listener();
}

function setSnapshot(next: PlatformSnapshot) {
  state = { ...state, snapshot: next, snapshotAt: Date.now(), snapshotConnected: true };
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
  emit();
}

async function refreshSnapshot() {
  try {
    setSnapshot(await getPlatformSnapshot());
  } catch {
    state = { ...state, snapshotConnected: false };
    emit();
  }
}

async function refreshFeedback() {
  const [servoResult, propulsionResult] = await Promise.allSettled([getServoSnapshot(), getPropulsionSnapshot()]);
  const connected = servoResult.status === "fulfilled" || propulsionResult.status === "fulfilled";
  const servos = servoResult.status === "fulfilled" ? servoResult.value : null;
  const propulsion = propulsionResult.status === "fulfilled" ? propulsionResult.value : null;
  setFeedback(servos, propulsion, connected);
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

export const platformStore = {
  subscribe,
  getSnapshot,
};
