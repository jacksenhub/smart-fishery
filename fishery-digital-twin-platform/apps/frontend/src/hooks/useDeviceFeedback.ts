"use client";

import { useSyncExternalStore } from "react";
import { platformStore } from "@/lib/platformStore";

// Reads the shared store so the digital twin and every other module reflect the
// same device feedback (servos / propulsion) in real time.
export function useDeviceFeedback(_intervalMs = 1000) {
  const data = useSyncExternalStore(platformStore.subscribe, platformStore.getSnapshot, platformStore.getSnapshot);
  return {
    servos: data.servos,
    propulsion: data.propulsion,
    connected: data.feedbackConnected,
    updatedAt: data.feedbackAt ? new Date(data.feedbackAt) : null,
  };
}
