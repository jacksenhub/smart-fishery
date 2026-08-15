"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ServoDevice } from "@fishery/shared";
import { setServoAngles, setServoChannel } from "@/lib/api";
import { useDeviceFeedback } from "@/hooks/useDeviceFeedback";
import { platformStore } from "@/lib/platformStore";
import { PageFrame } from "@/components/dashboard/DashboardPrimitives";
import { DualLinearActuatorCard } from "@/components/dashboard/DualLinearActuatorCard";
import {
  GimbalTargetController,
  type GimbalDirection,
  type GimbalTrackingStatus,
} from "@/components/dashboard/GimbalTargetController";
import { MotorControlCard, type MotorControlConfig } from "@/components/dashboard/MotorControlCard";
import type {
  CameraTrackingObservation,
  CameraTrackingProfile,
} from "@/components/dashboard/NavigationCameraPanel";

const SERVO_CHANNELS_PER_BOARD = 4;
const GIMBAL_DEVICE_ID = "servo-quad-01";
const GIMBAL_VERTICAL_CHANNEL_INDEX = 0;
const GIMBAL_HORIZONTAL_CHANNEL_INDEX = 1;
const GIMBAL_STEP_DEGREES = 5;
const GIMBAL_REPEAT_INTERVAL_MS = 260;
const GIMBAL_CENTER_ANGLE = 90;
const GIMBAL_MAX_ANGLE = 160;
const WATER_CANNON_DEVICE_ID = "servo-quad-02";
const WATER_CANNON_CHANNEL_INDEX = 1;
const WATER_CANNON_OPEN_ANGLE = 60;
const WATER_CANNON_CLOSED_VERTICAL_ANGLE = 90;
const AUTO_TRACKING_REPEAT_INTERVAL_MS = 100;
const AUTO_TRACKING_LOST_TIMEOUT_MS = 1_100;
const AUTO_TRACKING_REQUIRED_FRAMES: Record<CameraTrackingProfile, number> = {
  trash: 4,
  "bottle-test": 2,
};
const AUTO_TRACKING_LOCK_ENTER_DEAD_ZONE = 0.02;
const AUTO_TRACKING_LOCK_EXIT_DEAD_ZONE = 0.035;
const GIMBAL_HORIZONTAL_FOV_DEGREES = 70;
const GIMBAL_VERTICAL_FOV_DEGREES = 43;
const AUTO_TRACKING_PROPORTIONAL_GAIN = 0.72;
const AUTO_TRACKING_MAX_STEP_DEGREES = 10;
// Physical calibration for this mount: increasing GPIO26 moves left, and
// increasing GPIO25 moves down. Tracking corrections use the same mapping.
const GIMBAL_HORIZONTAL_ERROR_DIRECTION: 1 | -1 = -1;
const GIMBAL_VERTICAL_ERROR_DIRECTION: 1 | -1 = 1;
const BOTTLE_TRACKING_CLASSES = new Set(["bottle", "plastic_bottle"]);
const DEFAULT_TRACKING_PROFILE: CameraTrackingProfile =
  process.env.NEXT_PUBLIC_YOLO_MODEL_URL ? "trash" : "bottle-test";
const SERVO_BOARD_CONFIGS = [
  { deviceId: "servo-quad-01", label: "ESP32 开发板 1", reservedChannels: [4] },
  { deviceId: "servo-quad-02", label: "ESP32 开发板 2", reservedChannels: [2] },
] as const;
const GB555_MOTOR_CONFIG: MotorControlConfig = {
  deviceId: "maker-esp32-pro-dc-01",
  title: "12V 37GB555 电机",
  boardLabel: "ESP32 开发板 1",
  kind: "rotary",
  maxPower: 100,
  defaultPower: 50,
  positiveLabel: "正转",
  negativeLabel: "反转",
  momentary: false,
  showBoardFeedback: false,
};
const SXTL_MOTOR_CONFIG: MotorControlConfig = {
  deviceId: "maker-esp32-pro-linear-01-m1",
  title: "12V SXTL 电动推杆",
  boardLabel: "ESP32 开发板 2",
  kind: "linear",
  maxPower: 100,
  defaultPower: 100,
  positiveLabel: "伸出",
  negativeLabel: "收回",
  momentary: false,
  directionMultiplier: -1,
  showRuntimeProtection: true,
  showDeviceId: false,
};

function allAnglesForDevice(deviceId: string, angle: number, currentAngles: number[]) {
  return deviceId === "servo-quad-01"
    ? [angle, angle, angle, 90]
    : [angle, currentAngles[WATER_CANNON_CHANNEL_INDEX] ?? 90, angle, angle];
}

function configuredServoDevice(
  config: (typeof SERVO_BOARD_CONFIGS)[number],
  source?: ServoDevice,
): ServoDevice {
  return {
    device_id: config.deviceId,
    device_name: source?.device_name || config.label,
    target_angles: Array.from(
      { length: SERVO_CHANNELS_PER_BOARD },
      (_, index) => source?.target_angles[index] ?? 90,
    ),
    actual_angles: Array.from(
      { length: SERVO_CHANNELS_PER_BOARD },
      (_, index) => source?.actual_angles[index] ?? null,
    ),
    last_seen: source?.last_seen ?? null,
    updated_at: source?.updated_at ?? null,
    online: source?.online ?? false,
  };
}


export function ServosPage() {
  const { servos, propulsion } = useDeviceFeedback();
  const [draftAngles, setDraftAngles] = useState<Record<string, number[]>>({});
  const [gimbalError, setGimbalError] = useState<string | null>(null);
  const [waterCannonError, setWaterCannonError] = useState<string | null>(null);
  const [activeGimbalDirection, setActiveGimbalDirection] = useState<GimbalDirection | null>(null);
  const [autoTrackingEnabled, setAutoTrackingEnabled] = useState(false);
  const [trackingProfile, setTrackingProfile] = useState<CameraTrackingProfile>(
    DEFAULT_TRACKING_PROFILE,
  );
  const [trackingSafetyBlocked, setTrackingSafetyBlocked] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState<GimbalTrackingStatus>("off");
  const [trackingTargetLabel, setTrackingTargetLabel] = useState<string | null>(null);
  const [visibleTrackingObservation, setVisibleTrackingObservation] = useState<CameraTrackingObservation | null>(null);
  const [busy, setBusy] = useState(false);
  const gimbalAnglesRef = useRef<number[]>([90, 90, 90, 90]);
  const gimbalCommandInFlight = useRef(false);
  const autoTrackingCommandInFlight = useRef(false);
  const latestTrackingObservationRef = useRef<CameraTrackingObservation | null>(null);
  const trackingStableFramesRef = useRef(0);
  const trackingSafetyBlockedRef = useRef(false);
  const trackingLockedRef = useRef(false);
  const lastTrackingSeenAtRef = useRef(0);
  const lastAppliedTrackingObservationAtRef = useRef(0);
  const observationFadeTimerRef = useRef<number | null>(null);
  const devices = useMemo(
    () => SERVO_BOARD_CONFIGS.map((config) => configuredServoDevice(
      config,
      servos?.devices.find((device) => device.device_id === config.deviceId),
    )),
    [servos],
  );
  const onlineDevices = devices.filter((device) => device.online);
  const gimbalDevice = devices[0];
  const waterCannonDevice = devices[1];
  const gimbalAngles = draftAngles[GIMBAL_DEVICE_ID] || gimbalDevice.target_angles;
  const gimbalHorizontalTarget =
    gimbalAngles[GIMBAL_HORIZONTAL_CHANNEL_INDEX] ?? GIMBAL_CENTER_ANGLE;
  const gimbalVerticalTarget =
    gimbalAngles[GIMBAL_VERTICAL_CHANNEL_INDEX] ?? GIMBAL_CENTER_ANGLE;
  const gimbalHorizontalActual =
    gimbalDevice.actual_angles[GIMBAL_HORIZONTAL_CHANNEL_INDEX] ?? null;
  const gimbalVerticalActual =
    gimbalDevice.actual_angles[GIMBAL_VERTICAL_CHANNEL_INDEX] ?? null;
  const waterCannonAngles = draftAngles[WATER_CANNON_DEVICE_ID]
    || waterCannonDevice.target_angles;
  const waterCannonAngle = waterCannonAngles[WATER_CANNON_CHANNEL_INDEX]
    ?? WATER_CANNON_CLOSED_VERTICAL_ANGLE;
  const waterCannonEnabled = Math.abs(waterCannonAngle - WATER_CANNON_OPEN_ANGLE)
    < Math.abs(waterCannonAngle - WATER_CANNON_CLOSED_VERTICAL_ANGLE);

  useEffect(() => {
    if (!servos) return;
    setDraftAngles((current) => {
      const merged = { ...current };
      let changed = false;
      servos.devices.forEach((device) => {
        if (!merged[device.device_id]) {
          merged[device.device_id] = [...device.target_angles];
          changed = true;
        }
      });
      return changed ? merged : current;
    });
  }, [servos]);

  useEffect(() => {
    gimbalAnglesRef.current = [...gimbalAngles];
  }, [gimbalAngles]);

  const clampServoAngle = useCallback((angle: number) => {
    if (!Number.isFinite(angle)) return 90;
    return Math.min(GIMBAL_MAX_ANGLE, Math.max(0, Math.round(angle)));
  }, []);

  const setDraft = useCallback((deviceId: string, channelIndex: number, angle: number) => {
    setDraftAngles((current) => {
      const next = current[deviceId] ? [...current[deviceId]] : [90, 90, 90, 90];
      next[channelIndex] = clampServoAngle(angle);
      return { ...current, [deviceId]: next };
    });
  }, [clampServoAngle]);

  const handleTrackingObservation = useCallback((observation: CameraTrackingObservation | null) => {
    if (observationFadeTimerRef.current !== null) {
      window.clearTimeout(observationFadeTimerRef.current);
      observationFadeTimerRef.current = null;
    }

    if (!observation) {
      trackingStableFramesRef.current = Math.max(0, trackingStableFramesRef.current - 1);
      observationFadeTimerRef.current = window.setTimeout(() => {
        setVisibleTrackingObservation(null);
        observationFadeTimerRef.current = null;
      }, 900);
      return;
    }

    const previous = latestTrackingObservationRef.current;
    const sameTrackingClass = previous
      ? previous.className === observation.className
        || (
          BOTTLE_TRACKING_CLASSES.has(previous.className.toLowerCase())
          && BOTTLE_TRACKING_CLASSES.has(observation.className.toLowerCase())
        )
      : false;
    const sameBottleTarget = previous
      ? BOTTLE_TRACKING_CLASSES.has(previous.className.toLowerCase())
        && BOTTLE_TRACKING_CLASSES.has(observation.className.toLowerCase())
      : false;
    const observationGapMs = previous
      ? observation.timestamp - previous.timestamp
      : Number.POSITIVE_INFINITY;
    const normalizedMovement = previous
      ? Math.hypot(
          (previous.centerX - observation.centerX) / observation.frameWidth,
          (previous.centerY - observation.centerY) / observation.frameHeight,
        )
      : Number.POSITIVE_INFINITY;
    const spatiallyStable = previous
      && sameTrackingClass
      && observationGapMs <= AUTO_TRACKING_LOST_TIMEOUT_MS
      && normalizedMovement < (sameBottleTarget ? 0.36 : 0.12);
    // A moving bottle needs low-lag coordinates; a nearly stationary box needs
    // stronger smoothing so detector jitter does not shake the gimbal.
    const newObservationWeight = normalizedMovement > 0.04 ? 0.8 : 0.35;
    const smoothedObservation = previous
      && sameTrackingClass
      && previous.frameWidth === observation.frameWidth
      && previous.frameHeight === observation.frameHeight
      ? {
          ...observation,
          centerX: previous.centerX * (1 - newObservationWeight) + observation.centerX * newObservationWeight,
          centerY: previous.centerY * (1 - newObservationWeight) + observation.centerY * newObservationWeight,
        }
      : observation;

    trackingStableFramesRef.current = spatiallyStable
      ? Math.min(12, trackingStableFramesRef.current + 1)
      : 1;
    latestTrackingObservationRef.current = smoothedObservation;
    lastTrackingSeenAtRef.current = observation.timestamp;
    setVisibleTrackingObservation(smoothedObservation);
    setTrackingTargetLabel(observation.label);
  }, []);

  const handleTrackingSafetyChange = useCallback((blocked: boolean) => {
    trackingSafetyBlockedRef.current = blocked;
    setTrackingSafetyBlocked(blocked);
    if (blocked) {
      trackingStableFramesRef.current = 0;
      trackingLockedRef.current = false;
    }
  }, []);

  useEffect(() => () => {
    if (observationFadeTimerRef.current !== null) {
      window.clearTimeout(observationFadeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!activeGimbalDirection) return;
    if (!gimbalDevice.online) {
      setActiveGimbalDirection(null);
      return;
    }

    let cancelled = false;
    const moveOneStep = async () => {
      if (cancelled || gimbalCommandInFlight.current) return;

      const horizontal = activeGimbalDirection === "left" || activeGimbalDirection === "right";
      const channelIndex = horizontal
        ? GIMBAL_HORIZONTAL_CHANNEL_INDEX
        : GIMBAL_VERTICAL_CHANNEL_INDEX;
      // This mount is reversed on both axes: increasing GPIO26 moves left,
      // while increasing GPIO25 moves down.
      const positiveDirection = activeGimbalDirection === "left" || activeGimbalDirection === "down";
      const previousAngle = gimbalAnglesRef.current[channelIndex] ?? GIMBAL_CENTER_ANGLE;
      const nextAngle = clampServoAngle(
        previousAngle + (positiveDirection ? GIMBAL_STEP_DEGREES : -GIMBAL_STEP_DEGREES),
      );

      if (nextAngle === previousAngle) {
        setActiveGimbalDirection(null);
        return;
      }

      const nextAngles = [...gimbalAnglesRef.current];
      nextAngles[channelIndex] = nextAngle;
      gimbalAnglesRef.current = nextAngles;
      setDraft(GIMBAL_DEVICE_ID, channelIndex, nextAngle);
      gimbalCommandInFlight.current = true;
      setGimbalError(null);

      try {
        const result = await setServoChannel(GIMBAL_DEVICE_ID, channelIndex + 1, nextAngle);
        if (!cancelled) platformStore.applyFeedback({ servos: result.servos });
      } catch (error) {
        const restoredAngles = [...gimbalAnglesRef.current];
        restoredAngles[channelIndex] = previousAngle;
        gimbalAnglesRef.current = restoredAngles;
        setDraft(GIMBAL_DEVICE_ID, channelIndex, previousAngle);
        setGimbalError(error instanceof Error ? error.message : "水枪云台控制指令发送失败，请重试");
        setActiveGimbalDirection(null);
      } finally {
        gimbalCommandInFlight.current = false;
      }
    };

    void moveOneStep();
    const timer = window.setInterval(() => void moveOneStep(), GIMBAL_REPEAT_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeGimbalDirection, clampServoAngle, gimbalDevice.online, setDraft]);

  useEffect(() => {
    if (!autoTrackingEnabled) {
      latestTrackingObservationRef.current = null;
      trackingStableFramesRef.current = 0;
      trackingLockedRef.current = false;
      lastTrackingSeenAtRef.current = 0;
      lastAppliedTrackingObservationAtRef.current = 0;
      setTrackingStatus("off");
      setTrackingTargetLabel(null);
      return;
    }
    if (!gimbalDevice.online) {
      setAutoTrackingEnabled(false);
      setTrackingStatus("error");
      setGimbalError("开发板 1 已离线，自动跟踪已停止");
      return;
    }

    let cancelled = false;
    const applyTrackingCorrection = async () => {
      if (cancelled || autoTrackingCommandInFlight.current) return;

      if (trackingProfile !== "bottle-test" && trackingSafetyBlockedRef.current) {
        trackingLockedRef.current = false;
        setTrackingStatus("safety");
        return;
      }

      const observation = latestTrackingObservationRef.current;
      const lastSeenAge = Date.now() - lastTrackingSeenAtRef.current;
      if (!observation || lastTrackingSeenAtRef.current === 0) {
        trackingLockedRef.current = false;
        setTrackingStatus("waiting");
        return;
      }
      if (lastSeenAge > AUTO_TRACKING_LOST_TIMEOUT_MS) {
        trackingLockedRef.current = false;
        setTrackingStatus("lost");
        return;
      }
      const requiredStableFrames = AUTO_TRACKING_REQUIRED_FRAMES[trackingProfile]
        ?? AUTO_TRACKING_REQUIRED_FRAMES["bottle-test"];
      if (trackingStableFramesRef.current < requiredStableFrames) {
        trackingLockedRef.current = false;
        setTrackingStatus("acquiring");
        return;
      }
      if (observation.timestamp <= lastAppliedTrackingObservationAtRef.current) {
        return;
      }
      lastAppliedTrackingObservationAtRef.current = observation.timestamp;

      const horizontalError = (observation.centerX - observation.frameWidth / 2) / observation.frameWidth;
      const verticalError = (observation.centerY - observation.frameHeight / 2) / observation.frameHeight;
      const deadZone = trackingLockedRef.current
        ? AUTO_TRACKING_LOCK_EXIT_DEAD_ZONE
        : AUTO_TRACKING_LOCK_ENTER_DEAD_ZONE;
      const horizontalCentered = Math.abs(horizontalError) <= deadZone;
      const verticalCentered = Math.abs(verticalError) <= deadZone;
      if (horizontalCentered && verticalCentered) {
        trackingLockedRef.current = true;
        setTrackingStatus("locked");
        return;
      }
      trackingLockedRef.current = false;

      const correctionStep = (error: number, fieldOfViewDegrees: number) => {
        const estimatedAngularError = Math.abs(error) * fieldOfViewDegrees;
        return Math.min(
          AUTO_TRACKING_MAX_STEP_DEGREES,
          Math.max(1, Math.round(estimatedAngularError * AUTO_TRACKING_PROPORTIONAL_GAIN)),
        );
      };
      const previousAngles = [...gimbalAnglesRef.current];
      const nextAngles = [...previousAngles];

      if (!horizontalCentered) {
        const step = correctionStep(horizontalError, GIMBAL_HORIZONTAL_FOV_DEGREES);
        nextAngles[GIMBAL_HORIZONTAL_CHANNEL_INDEX] = clampServoAngle(
          (previousAngles[GIMBAL_HORIZONTAL_CHANNEL_INDEX] ?? GIMBAL_CENTER_ANGLE)
          + Math.sign(horizontalError) * step * GIMBAL_HORIZONTAL_ERROR_DIRECTION,
        );
      }
      if (!verticalCentered) {
        const step = correctionStep(verticalError, GIMBAL_VERTICAL_FOV_DEGREES);
        const verticalAngleDelta = Math.sign(verticalError)
          * step
          * GIMBAL_VERTICAL_ERROR_DIRECTION;
        nextAngles[GIMBAL_VERTICAL_CHANNEL_INDEX] = clampServoAngle(
          (previousAngles[GIMBAL_VERTICAL_CHANNEL_INDEX] ?? GIMBAL_CENTER_ANGLE)
          + verticalAngleDelta,
        );
      }

      if (
        nextAngles[GIMBAL_HORIZONTAL_CHANNEL_INDEX] === previousAngles[GIMBAL_HORIZONTAL_CHANNEL_INDEX]
        && nextAngles[GIMBAL_VERTICAL_CHANNEL_INDEX] === previousAngles[GIMBAL_VERTICAL_CHANNEL_INDEX]
      ) {
        setTrackingStatus("limit");
        return;
      }

      gimbalAnglesRef.current = nextAngles;
      setDraftAngles((current) => ({ ...current, [GIMBAL_DEVICE_ID]: nextAngles }));
      autoTrackingCommandInFlight.current = true;
      setTrackingStatus("tracking");
      setGimbalError(null);

      try {
        const result = await setServoAngles(GIMBAL_DEVICE_ID, nextAngles);
        if (!cancelled) platformStore.applyFeedback({ servos: result.servos });
      } catch (error) {
        gimbalAnglesRef.current = previousAngles;
        setDraftAngles((current) => ({ ...current, [GIMBAL_DEVICE_ID]: previousAngles }));
        setTrackingStatus("error");
        setGimbalError(error instanceof Error ? error.message : "自动跟踪指令发送失败");
        setAutoTrackingEnabled(false);
      } finally {
        autoTrackingCommandInFlight.current = false;
      }
    };

    void applyTrackingCorrection();
    const timer = window.setInterval(
      () => void applyTrackingCorrection(),
      AUTO_TRACKING_REPEAT_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [autoTrackingEnabled, clampServoAngle, gimbalDevice.online, trackingProfile]);

  async function setAllAngles(angle: number) {
    setActiveGimbalDirection(null);
    setAutoTrackingEnabled(false);
    const nextAngle = clampServoAngle(angle);
    const activeDevices = onlineDevices.length > 0 ? onlineDevices : [];
    setBusy(true);
    try {
      const results = await Promise.all(activeDevices.map((device) => (
        setServoAngles(
          device.device_id,
          allAnglesForDevice(device.device_id, nextAngle, device.target_angles),
        )
      )));
      const latest = results.at(-1);
      if (latest) platformStore.applyFeedback({ servos: latest.servos });
      setDraftAngles((current) => ({
        ...current,
        ...Object.fromEntries(activeDevices.map((device) => [
          device.device_id,
          allAnglesForDevice(device.device_id, nextAngle, device.target_angles),
        ])),
      }));
    } finally {
      setBusy(false);
    }
  }

  function toggleGimbalDirection(direction: GimbalDirection) {
    if (!gimbalDevice.online || busy) return;
    setAutoTrackingEnabled(false);
    setTrackingStatus("off");
    setGimbalError(null);
    setActiveGimbalDirection((current) => current === direction ? null : direction);
  }

  function toggleAutoTracking() {
    if (!gimbalDevice.online || busy) return;
    setActiveGimbalDirection(null);
    setGimbalError(null);

    if (autoTrackingEnabled) {
      setAutoTrackingEnabled(false);
      setTrackingStatus("off");
      return;
    }

    if (trackingProfile !== "bottle-test" && trackingSafetyBlockedRef.current) {
      setTrackingStatus("safety");
      setGimbalError("检测到人员靠近目标区域，自动跟踪未启动");
      return;
    }

    latestTrackingObservationRef.current = null;
    trackingStableFramesRef.current = 0;
    trackingLockedRef.current = false;
    lastTrackingSeenAtRef.current = 0;
    lastAppliedTrackingObservationAtRef.current = 0;
    setTrackingTargetLabel(null);
    setTrackingStatus("waiting");
    setAutoTrackingEnabled(true);
  }

  function changeTrackingProfile(profile: CameraTrackingProfile) {
    if (profile === trackingProfile) return;
    setAutoTrackingEnabled(false);
    setActiveGimbalDirection(null);
    setTrackingProfile(profile);
    setTrackingStatus("off");
    setTrackingTargetLabel(null);
    setVisibleTrackingObservation(null);
    setGimbalError(null);
    latestTrackingObservationRef.current = null;
    trackingStableFramesRef.current = 0;
    trackingLockedRef.current = false;
    lastAppliedTrackingObservationAtRef.current = 0;
    trackingSafetyBlockedRef.current = false;
    setTrackingSafetyBlocked(false);
  }

  async function commitWaterCannonAngle(angle: number) {
    if (!waterCannonDevice.online || busy) return;

    const previousAngle = waterCannonDevice.target_angles[WATER_CANNON_CHANNEL_INDEX]
      ?? WATER_CANNON_CLOSED_VERTICAL_ANGLE;
    const nextAngle = Math.min(180, Math.max(0, Math.round(angle)));
    if (nextAngle === previousAngle) return;

    setWaterCannonError(null);
    setDraft(WATER_CANNON_DEVICE_ID, WATER_CANNON_CHANNEL_INDEX, nextAngle);
    setBusy(true);
    try {
      const result = await setServoChannel(
        WATER_CANNON_DEVICE_ID,
        WATER_CANNON_CHANNEL_INDEX + 1,
        nextAngle,
      );
      platformStore.applyFeedback({ servos: result.servos });
    } catch (error) {
      setDraft(WATER_CANNON_DEVICE_ID, WATER_CANNON_CHANNEL_INDEX, previousAngle);
      setWaterCannonError(error instanceof Error ? error.message : "水枪角度指令发送失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function centerGimbal() {
    setActiveGimbalDirection(null);
    setAutoTrackingEnabled(false);
    if (!gimbalDevice.online || busy) return;

    const previousAngles = [...gimbalAngles];
    const nextAngles = [...gimbalAngles];
    nextAngles[GIMBAL_HORIZONTAL_CHANNEL_INDEX] = GIMBAL_CENTER_ANGLE;
    nextAngles[GIMBAL_VERTICAL_CHANNEL_INDEX] = GIMBAL_CENTER_ANGLE;

    setGimbalError(null);
    setDraftAngles((current) => ({ ...current, [GIMBAL_DEVICE_ID]: nextAngles }));
    setBusy(true);
    try {
      const result = await setServoAngles(GIMBAL_DEVICE_ID, nextAngles);
      platformStore.applyFeedback({ servos: result.servos });
    } catch (error) {
      setDraftAngles((current) => ({ ...current, [GIMBAL_DEVICE_ID]: previousAngles }));
      setGimbalError(error instanceof Error ? error.message : "云台归中指令发送失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageFrame wide>
      <section className="rounded-[28px] bg-transparent text-ink-900">
        <div className="flex flex-col gap-5 rounded-[26px] border border-app-line bg-white p-5 shadow-soft md:flex-row md:items-center md:justify-between md:p-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-ink-900 md:text-3xl">功能操控</h1>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              {devices.map((device, index) => (
                <ServoOnlineDot key={device.device_id} label={`开发板 ${index + 1}`} online={device.online} />
              ))}
              <span className="text-sm font-semibold text-ink-500">
                {onlineDevices.length}/{SERVO_BOARD_CONFIGS.length} 开发板在线
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <ServoConsoleButton
              label="全部复位 0°"
              onClick={() => setAllAngles(0)}
              disabled={busy || onlineDevices.length === 0}
              variant="outline"
            />
            <ServoConsoleButton
              label="全部归中 90°"
              onClick={() => setAllAngles(90)}
              disabled={busy || onlineDevices.length === 0}
              variant="primary"
            />
          </div>
        </div>

        <GimbalTargetController
          online={gimbalDevice.online}
          busy={busy}
          horizontalTargetAngle={gimbalHorizontalTarget}
          verticalTargetAngle={gimbalVerticalTarget}
          horizontalActualAngle={gimbalHorizontalActual}
          verticalActualAngle={gimbalVerticalActual}
          stepDegrees={GIMBAL_STEP_DEGREES}
          maximumAngle={GIMBAL_MAX_ANGLE}
          activeDirection={activeGimbalDirection}
          autoTrackingEnabled={autoTrackingEnabled}
          trackingProfile={trackingProfile}
          trackingSafetyBlocked={trackingProfile !== "bottle-test" && trackingSafetyBlocked}
          trackingStatus={trackingStatus}
          trackingTargetLabel={trackingTargetLabel}
          trackingObservation={visibleTrackingObservation}
          error={gimbalError}
          onDirection={toggleGimbalDirection}
          onCenter={() => void centerGimbal()}
          onAutoTrackingToggle={toggleAutoTracking}
          onTrackingProfileChange={changeTrackingProfile}
          onTrackingObservation={handleTrackingObservation}
          onTrackingSafetyChange={handleTrackingSafetyChange}
        />

        <section className="mt-6 rounded-[26px] border border-app-line bg-white p-5 shadow-soft md:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className={`grid h-12 w-12 place-items-center rounded-2xl text-sm font-bold ${
                waterCannonEnabled
                  ? "bg-sky-100 text-sky-700"
                  : "bg-app-subtle text-ink-500"
              }`}>
                水
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-ink-900">水枪开关</h2>
                  <span className={`h-2.5 w-2.5 rounded-full ${waterCannonDevice.online ? "bg-sage-500" : "bg-ink-500/45"}`} />
                </div>
                <p className="mt-1 text-xs font-semibold text-ink-500">开发板 2 · 舵机 2 · GPIO26</p>
              </div>
            </div>

            <div className="inline-flex rounded-2xl border border-app-line bg-app-subtle p-1" role="group" aria-label="水枪开关">
              <button
                type="button"
                onClick={() => void commitWaterCannonAngle(WATER_CANNON_OPEN_ANGLE)}
                disabled={!waterCannonDevice.online || busy}
                aria-pressed={waterCannonEnabled}
                className={`min-h-11 rounded-xl px-5 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ${
                  waterCannonEnabled
                    ? "bg-sky-500 text-white shadow-sm"
                    : "text-ink-500 hover:text-sky-700"
                }`}
              >
                开启
              </button>
              <button
                type="button"
                onClick={() => void commitWaterCannonAngle(WATER_CANNON_CLOSED_VERTICAL_ANGLE)}
                disabled={!waterCannonDevice.online || busy}
                aria-pressed={!waterCannonEnabled}
                className={`min-h-11 rounded-xl px-5 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ${
                  !waterCannonEnabled
                    ? "bg-white text-ink-900 shadow-sm"
                    : "text-ink-500 hover:text-ink-900"
                }`}
              >
                关闭
              </button>
            </div>
          </div>
          {waterCannonError ? (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">
              {waterCannonError}
            </p>
          ) : null}
        </section>

        <div className="mt-6 space-y-6">
          <section className="overflow-hidden rounded-[26px] border border-app-line bg-white shadow-soft">
            <div className="flex flex-col gap-2 border-b border-app-line bg-[linear-gradient(110deg,#f8fbfb_0%,#eef9f8_100%)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
              <div>
                <p className="text-xs font-semibold text-harbor-600">ESP32 开发板 1</p>
                <h2 className="mt-1 text-lg font-semibold text-ink-900">组合执行控制</h2>
              </div>
            </div>
            <div className="grid divide-y divide-app-line xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.35fr)] xl:divide-x xl:divide-y-0">
              <MotorControlCard
                embedded
                config={GB555_MOTOR_CONFIG}
                device={propulsion?.devices.find((device) => device.device_id === GB555_MOTOR_CONFIG.deviceId)}
              />
              <DualLinearActuatorCard
                embedded
                device={propulsion?.devices.find((device) => device.device_id === "maker-esp32-pro-linear-02")}
              />
            </div>
          </section>

          <MotorControlCard
            config={SXTL_MOTOR_CONFIG}
            device={propulsion?.devices.find((device) => device.device_id === SXTL_MOTOR_CONFIG.deviceId)}
          />
        </div>
      </section>
    </PageFrame>
  );
}

function ServoOnlineDot({ label, online }: { label: string; online: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink-500">
      <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-sage-500 shadow-[0_0_8px_rgba(79,137,104,0.3)]" : "bg-ink-500/55"}`} />
      {label}
    </span>
  );
}

function ServoConsoleButton({
  label,
  onClick,
  disabled,
  variant,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant: "primary" | "outline";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-2xl border px-5 py-3 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ${
        variant === "primary"
          ? "border-harbor-600 bg-harbor-600 text-white shadow-sm hover:bg-harbor-500"
          : "border-app-line bg-white text-ink-700 hover:border-harbor-500/45 hover:text-harbor-600"
      }`}
    >
      {label}
    </button>
  );
}
