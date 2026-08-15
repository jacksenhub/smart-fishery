"use client";

import { useSyncExternalStore } from "react";
import { platformStore } from "@/lib/platformStore";

// Reads the shared store so the digital twin and every other module reflect the
// same device feedback (servos / propulsion) in real time.
export function useDeviceFeedback(_intervalMs = 1000) {
  void _intervalMs;
  const data = useSyncExternalStore(
    platformStore.subscribe,
    platformStore.getDeviceFeedbackSlice,
    platformStore.getServerDeviceFeedbackSlice,
  );
  return {
    servos: data.servos,
    propulsion: data.propulsion,
    connected: data.feedbackConnected,
    updatedAt: data.feedbackAt ? new Date(data.feedbackAt) : null,
  };
}
