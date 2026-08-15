"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CameraOff, Circle, Download, Maximize2, RefreshCw, Square, Video, Waves } from "lucide-react";
import { fishCountFromDensity, UnderwaterFishScene } from "@/components/three/UnderwaterFishScene";
import {
  ANALYSIS_WIDTH,
  ANALYSIS_HEIGHT,
  type FishAnalysisResult,
  type FishVisionFrame,
} from "@/lib/fish-vision";
import {
  drawRecognizedObjects,
  loadBrowserObjectDetector,
  recognizedObjectsToFishMapping,
  type DetectorEngine,
  type RecognizedObject,
} from "@/lib/object-detector";

type CameraState = "idle" | "requesting" | "live" | "error";
type CameraViewMode = "camera" | "fish-3d";
type DetectorState = "waiting" | "loading" | "running" | "error";

export type CameraPurpose = "water-observation" | "gimbal-tracking";

const CAMERA_PURPOSE_CONFIG: Record<CameraPurpose, {
  storageKey: string;
  selectLabel: string;
  filePrefix: string;
  preferredDeviceLabel: RegExp;
  defaultDeviceLabel: string;
}> = {
  "water-observation": {
    storageKey: "uisys-camera-water-observation-v3",
    selectLabel: "水域观测摄像头",
    filePrefix: "water-observation-camera",
    preferredDeviceLabel: /usb video/i,
    defaultDeviceLabel: "USB Video",
  },
  "gimbal-tracking": {
    storageKey: "uisys-camera-gimbal-tracking-v3",
    selectLabel: "水枪云台摄像头",
    filePrefix: "gimbal-tracking-camera",
    preferredDeviceLabel: /wn[\s_-]*camera/i,
    defaultDeviceLabel: "WN Camera",
  },
};

const CAMERA_OPEN_TIMEOUT_MS = 8_000;
const CAMERA_FRAME_TIMEOUT_MS = 8_000;
const UNSUPPORTED_CAMERA_LABEL = /(^|\s)(ir|infrared)(\s|$)|windows hello|红外/i;
const EXTERNAL_CAMERA_LABEL = /usb video|capture|external|uvc|webcam/i;
const INTEGRATED_CAMERA_LABEL = /integrated|front|hp\s+\d+mp/i;

class CameraStartTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CameraStartTimeoutError";
  }
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function orderUsableCameraDevices(devices: MediaDeviceInfo[], preferredDeviceLabel: RegExp) {
  const priority = (device: MediaDeviceInfo) => {
    if (preferredDeviceLabel.test(device.label)) return 0;
    if (EXTERNAL_CAMERA_LABEL.test(device.label)) return 1;
    if (INTEGRATED_CAMERA_LABEL.test(device.label)) return 3;
    return 2;
  };

  return devices
    .filter((device) => !UNSUPPORTED_CAMERA_LABEL.test(device.label))
    .sort((left, right) => priority(left) - priority(right));
}

function createCameraConstraintCandidates(deviceId = ""): MediaStreamConstraints[] {
  if (deviceId) {
    return [
      { video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { deviceId: { exact: deviceId } }, audio: false },
      { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: true, audio: false },
    ];
  }

  return [
    { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    { video: true, audio: false },
  ];
}

async function tryCameraConstraints(constraintsList: MediaStreamConstraints[]) {
  let lastError: unknown = new Error("没有找到可用的摄像头配置。");
  for (const constraints of constraintsList) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === "NotAllowedError") throw error;
    }
  }
  throw lastError;
}

function requestCameraStream(constraintsList: MediaStreamConstraints[]) {
  return new Promise<MediaStream>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new CameraStartTimeoutError(
        "等待摄像头响应超时。请强制刷新页面释放本次请求，并关闭其他占用摄像头的程序后重试。",
      ));
    }, CAMERA_OPEN_TIMEOUT_MS);

    tryCameraConstraints(constraintsList).then(
      (stream) => {
        if (settled) {
          stopMediaStream(stream);
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(stream);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function waitForCameraFrame(video: HTMLVideoElement) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("error", onVideoError);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) finish();
    };
    const onVideoError = () => finish(new Error("浏览器无法播放摄像头返回的画面。"));
    const timeoutId = window.setTimeout(() => {
      finish(new CameraStartTimeoutError(
        "摄像头已连接，但没有返回画面。请更换 USB 接口或关闭其他摄像头软件后重试。",
      ));
    }, CAMERA_FRAME_TIMEOUT_MS);

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("playing", onReady);
    video.addEventListener("error", onVideoError);
    void video.play().then(onReady, () => {
      // Some USB capture devices reject the first explicit play call while
      // autoplay is already negotiating. Metadata/playing events remain authoritative.
    });
    onReady();
  });
}

function readRememberedCameraDevice(storageKey: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

function rememberCameraDevice(storageKey: string, deviceId: string) {
  if (typeof window === "undefined") return;
  try {
    if (deviceId) {
      window.localStorage.setItem(storageKey, deviceId);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Camera selection still works for this session when storage is unavailable.
  }
}

export interface CameraTrackingObservation {
  className: string;
  label: string;
  score: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  frameWidth: number;
  frameHeight: number;
  timestamp: number;
}

export type CameraTrackingProfile = "trash" | "bottle-test";

function normalizeTrackingProfile(profile: CameraTrackingProfile | string): CameraTrackingProfile {
  return profile === "trash" ? "trash" : "bottle-test";
}

const TRACKING_PROFILE_CLASSES: Record<CameraTrackingProfile, ReadonlySet<string>> = {
  trash: new Set([
    "plastic_bottle",
    "plastic_bag",
    "can",
    "foam",
    "fishing_net",
    "branch",
    "other_trash",
    "bottle",
  ]),
  "bottle-test": new Set(["bottle", "plastic_bottle"]),
};
const TRACKING_PROFILE_ACQUIRE_SCORE: Record<CameraTrackingProfile, number> = {
  trash: 0.6,
  "bottle-test": 0.4,
};
const TRACKING_PROFILE_MAINTAIN_SCORE: Record<CameraTrackingProfile, number> = {
  trash: 0.5,
  "bottle-test": 0.35,
};
const TRACKING_PROFILE_MINIMUM_AREA_RATIO: Record<CameraTrackingProfile, number> = {
  trash: 0.00015,
  "bottle-test": 0.00012,
};
const PERSON_SAFETY_MINIMUM_SCORE = 0.45;
const TRACKING_LOCK_MAX_AGE_MS = 1_500;
const MAXIMUM_DETECTION_BOXES = 40;
const TARGET_DETECTION_CYCLE_MS = 150;
const MINIMUM_DETECTION_PAUSE_MS = 24;

const EMPTY_VISION_FRAME: FishVisionFrame = {
  density: 0,
  observations: [],
  motionRatio: 0,
  timestamp: 0,
};

interface NavigationCameraPanelProps {
  cameraPurpose?: CameraPurpose;
  fishDensity?: number;
  densitySource?: "camera" | "sonar";
  embedded?: boolean;
  trackingEnabled?: boolean;
  trackingProfile?: CameraTrackingProfile;
  onTrackingObservation?: (observation: CameraTrackingObservation | null) => void;
  onTrackingSafetyChange?: (blocked: boolean) => void;
}

export function NavigationCameraPanel({
  cameraPurpose = "water-observation",
  fishDensity: detectedFishDensity,
  densitySource = "camera",
  embedded = false,
  trackingEnabled = false,
  trackingProfile = "trash",
  onTrackingObservation,
  onTrackingSafetyChange,
}: NavigationCameraPanelProps = {}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectionCanvasRef = useRef<HTMLCanvasElement>(null);
  const minimumScoreRef = useRef(0.35);
  const trackingProfileRef = useRef<CameraTrackingProfile>(normalizeTrackingProfile(trackingProfile));
  const previousTrackingObservationRef = useRef<CameraTrackingObservation | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const cameraRequestRef = useRef(0);
  const visionSensitivityRef = useRef(62);
  const fishFrameIdRef = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [error, setError] = useState("");
  const [resolution, setResolution] = useState("--");
  const [secureContext, setSecureContext] = useState(true);
  const [mediaSupported, setMediaSupported] = useState(true);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [viewMode, setViewMode] = useState<CameraViewMode>("camera");
  const [visionSensitivity, setVisionSensitivity] = useState(62);
  const [visionFrame, setVisionFrame] = useState<FishVisionFrame>(EMPTY_VISION_FRAME);
  const [objectDetectionEnabled, setObjectDetectionEnabled] = useState(true);
  const [detectorState, setDetectorState] = useState<DetectorState>("waiting");
  const detectorEngine: DetectorEngine = "yolo26";
  const [recognizedObjects, setRecognizedObjects] = useState<RecognizedObject[]>([]);
  const [inferenceMs, setInferenceMs] = useState(0);
  const cameraConfig = CAMERA_PURPOSE_CONFIG[cameraPurpose];
  const cameraDeviceSelectId = `camera-device-${cameraPurpose}`;
  const selectedCameraName = devices.find((device) => device.deviceId === selectedDeviceId)?.label
    || cameraConfig.defaultDeviceLabel;

  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1;
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRecording(false);
    setRecordingSeconds(0);
    setCameraState("idle");
    setResolution("--");
  }, []);

  const cancelCameraRequest = useCallback(() => {
    stopCamera();
    window.location.reload();
  }, [stopCamera]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setMediaSupported(false);
      return;
    }
    try {
      const nextDevices = orderUsableCameraDevices(
        (await navigator.mediaDevices.enumerateDevices())
          .filter((device) => device.kind === "videoinput"),
        cameraConfig.preferredDeviceLabel,
      );
      const rememberedDeviceId = readRememberedCameraDevice(cameraConfig.storageKey);
      setDevices(nextDevices);
      setSelectedDeviceId((current) => {
        if (current && nextDevices.some((device) => device.deviceId === current)) return current;
        if (rememberedDeviceId && nextDevices.some((device) => device.deviceId === rememberedDeviceId)) {
          return rememberedDeviceId;
        }
        const preferredDevice = nextDevices.find((device) => cameraConfig.preferredDeviceLabel.test(device.label));
        return preferredDevice?.deviceId ?? "";
      });
    } catch (deviceError) {
      setDevices([]);
      setError(deviceError instanceof Error ? deviceError.message : "读取摄像头设备列表失败。");
    }
  }, [cameraConfig.preferredDeviceLabel, cameraConfig.storageKey]);

  const selectCameraDevice = useCallback((deviceId: string) => {
    rememberCameraDevice(cameraConfig.storageKey, deviceId);
    setSelectedDeviceId(deviceId);
    if (streamRef.current) stopCamera();
  }, [cameraConfig.storageKey, stopCamera]);

  useEffect(() => {
    setSecureContext(window.isSecureContext);
    setMediaSupported(Boolean(navigator.mediaDevices?.getUserMedia));
    void refreshDevices();

    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
      cameraRequestRef.current += 1;
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [refreshDevices]);

  useEffect(() => {
    visionSensitivityRef.current = visionSensitivity;
  }, [visionSensitivity]);

  useEffect(() => {
    if (cameraState !== "live" || embedded) {
      setVisionFrame(EMPTY_VISION_FRAME);
      return;
    }

    // The heavy BFS flood-fill analysis runs in a dedicated worker so the 3D
    // fish scene and UI never stall on a detection frame. The main thread only
    // grabs a small 160x90 frame and transfers its pixel buffer across.
    const worker = new Worker(new URL("../../lib/fish-vision.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<FishAnalysisResult>) => {
      if (event.data?.type === "result") {
        setVisionFrame(event.data.frame);
      }
    };

    const analysisCanvas = document.createElement("canvas");
    analysisCanvas.width = ANALYSIS_WIDTH;
    analysisCanvas.height = ANALYSIS_HEIGHT;
    const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });

    let animationFrame = 0;
    let previousAnalysisTime = 0;
    const analyzeFrame = (time: number) => {
      if (
        time - previousAnalysisTime >= 100
        && analysisContext
        && videoRef.current
        && videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && videoRef.current.videoWidth > 0
      ) {
        analysisContext.drawImage(videoRef.current, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
        const imageData = analysisContext.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
        previousAnalysisTime = time;
        // Transfer the underlying pixel buffer to the worker. It becomes
        // detached on the main thread afterwards, which is safe because a fresh
        // ImageData buffer is allocated on every frame.
        worker.postMessage(
          {
            type: "analyze",
            pixels: imageData.data,
            sensitivity: visionSensitivityRef.current,
            frameId: fishFrameIdRef.current++,
          },
          [imageData.data.buffer],
        );
      }
      animationFrame = window.requestAnimationFrame(analyzeFrame);
    };
    animationFrame = window.requestAnimationFrame(analyzeFrame);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      worker.terminate();
    };
  }, [cameraState, embedded]);

  useEffect(() => {
    trackingProfileRef.current = normalizeTrackingProfile(trackingProfile);
  }, [trackingProfile]);

  useEffect(() => {
    const canvas = detectionCanvasRef.current;
    const video = videoRef.current;
    if (cameraState !== "live" || !objectDetectionEnabled) {
      setDetectorState("waiting");
      setRecognizedObjects([]);
      setInferenceMs(0);
      if (canvas && video) drawRecognizedObjects(canvas, video, []);
      return;
    }

    let cancelled = false;
    let nextDetectionTimer = 0;
    let detector: Awaited<ReturnType<typeof loadBrowserObjectDetector>> | null = null;

    const runDetection = async () => {
      if (cancelled || !detector || !videoRef.current) return;
      const currentVideo = videoRef.current;
      if (currentVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        nextDetectionTimer = window.setTimeout(() => void runDetection(), 120);
        return;
      }

      try {
        const detectionMinimumScore = embedded
          ? Math.min(minimumScoreRef.current, PERSON_SAFETY_MINIMUM_SCORE)
          : minimumScoreRef.current;
        const result = await detector.detect(
          currentVideo,
          detectionMinimumScore,
          MAXIMUM_DETECTION_BOXES,
        );
        if (cancelled) return;
        const visibleObjects = embedded && trackingProfileRef.current === "bottle-test"
          ? result.objects.filter((object) => (
              TRACKING_PROFILE_CLASSES["bottle-test"].has(object.className.toLowerCase())
            ))
          : result.objects;
        setRecognizedObjects(visibleObjects);
        setInferenceMs(result.inferenceMs);
        setDetectorState("running");
        if (detectionCanvasRef.current) {
          drawRecognizedObjects(detectionCanvasRef.current, currentVideo, visibleObjects);
        }
        nextDetectionTimer = window.setTimeout(
          () => void runDetection(),
          Math.max(MINIMUM_DETECTION_PAUSE_MS, TARGET_DETECTION_CYCLE_MS - result.inferenceMs),
        );
      } catch (detectionError) {
        if (cancelled) return;
        setDetectorState("error");
        void detectionError;
      }
    };

    const loadDetector = async () => {
      setDetectorState("loading");
      setRecognizedObjects([]);
      try {
        detector = await loadBrowserObjectDetector({ engine: detectorEngine });
        if (cancelled) {
          detector.dispose();
          return;
        }
        setDetectorState("running");
        void runDetection();
      } catch (loadError) {
        if (cancelled) return;
        setDetectorState("error");
        void loadError;
      }
    };

    void loadDetector();
    return () => {
      cancelled = true;
      if (nextDetectionTimer) window.clearTimeout(nextDetectionTimer);
      detector?.dispose();
    };
  }, [cameraState, detectorEngine, embedded, objectDetectionEnabled]);

  const trackingSelection = useMemo(() => {
    if (!embedded || !onTrackingObservation || cameraState !== "live") {
      return { observation: null, safetyBlocked: false };
    }
    const video = videoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      return { observation: null, safetyBlocked: false };
    }
    return selectAutoTrackingObservation(
      recognizedObjects,
      video.videoWidth,
      video.videoHeight,
      trackingProfile,
      previousTrackingObservationRef.current,
    );
  }, [cameraState, embedded, onTrackingObservation, recognizedObjects, trackingProfile]);
  const trackingObservation = trackingSelection.observation;

  useEffect(() => {
    if (trackingObservation) previousTrackingObservationRef.current = trackingObservation;
    onTrackingObservation?.(trackingObservation);
    onTrackingSafetyChange?.(trackingSelection.safetyBlocked);
  }, [onTrackingObservation, onTrackingSafetyChange, trackingObservation, trackingSelection.safetyBlocked]);

  async function startCamera() {
    if (!window.isSecureContext) {
      setCameraState("error");
      setError("摄像头权限要求使用 localhost 或 HTTPS，不能通过普通局域网 HTTP 地址访问。");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setError("当前浏览器不支持网页摄像头，请使用最新版 Edge 或 Chrome。");
      return;
    }

    stopCamera();
    const requestId = ++cameraRequestRef.current;
    setCameraState("requesting");
    setError("");

    const candidates = createCameraConstraintCandidates(selectedDeviceId);
    let lastError: unknown = new Error("没有找到可用的摄像头配置。");

    for (const constraints of candidates) {
      let stream: MediaStream | null = null;
      try {
        stream = await requestCameraStream([constraints]);
        if (cameraRequestRef.current !== requestId) {
          stopMediaStream(stream);
          return;
        }

        if (!selectedDeviceId) {
          const availableDevices = orderUsableCameraDevices(
            (await navigator.mediaDevices.enumerateDevices())
              .filter((device) => device.kind === "videoinput"),
            cameraConfig.preferredDeviceLabel,
          );
          const preferredDevice = availableDevices.find((device) => (
            cameraConfig.preferredDeviceLabel.test(device.label)
          ));

          setDevices(availableDevices);
          if (preferredDevice) {
            const activeDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
            if (activeDeviceId !== preferredDevice.deviceId) {
              try {
                const preferredStream = await requestCameraStream(
                  createCameraConstraintCandidates(preferredDevice.deviceId).slice(0, 2),
                );
                stopMediaStream(stream);
                stream = preferredStream;
              } catch {
                // Keep the browser-selected camera if the preferred device is temporarily unavailable.
              }
            }

            const finalDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
            if (!finalDeviceId || finalDeviceId === preferredDevice.deviceId) {
              setSelectedDeviceId(preferredDevice.deviceId);
              rememberCameraDevice(cameraConfig.storageKey, preferredDevice.deviceId);
            }
          }
        }

        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("摄像头没有返回可用的视频轨道。");
        const settings = track.getSettings();

        const video = videoRef.current;
        if (!video) throw new Error("摄像头预览组件尚未就绪，请刷新页面后重试。");
        video.srcObject = stream;
        await waitForCameraFrame(video);
        if (cameraRequestRef.current !== requestId) {
          stopMediaStream(stream);
          return;
        }

        streamRef.current = stream;

        track.addEventListener("ended", () => {
          if (streamRef.current !== stream) return;
          if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
          if (recordingTimerRef.current) {
            window.clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          streamRef.current = null;
          setRecording(false);
          setRecordingSeconds(0);
          setCameraState("error");
          setError("摄像头连接已断开，请检查 USB 接口后重新连接。");
          setResolution("--");
        }, { once: true });

        if (selectedDeviceId) {
          const selectedDeviceWasUsed = !settings.deviceId || settings.deviceId === selectedDeviceId;
          const activeSelection = selectedDeviceWasUsed ? selectedDeviceId : "";
          setSelectedDeviceId(activeSelection);
          rememberCameraDevice(cameraConfig.storageKey, activeSelection);
        }
        setResolution(settings.width && settings.height ? `${settings.width} × ${settings.height}` : "已连接");
        setCameraState("live");
        await refreshDevices();
        return;
      } catch (cameraError) {
        stopMediaStream(stream);
        if (streamRef.current === stream) streamRef.current = null;
        if (videoRef.current?.srcObject === stream) videoRef.current.srcObject = null;
        if (cameraRequestRef.current !== requestId) return;

        const name = cameraError instanceof DOMException ? cameraError.name : "";
        if (name === "NotAllowedError") {
          lastError = cameraError;
          break;
        }

        lastError = cameraError;
      }
    }

    if (cameraRequestRef.current !== requestId) return;
    const name = lastError instanceof DOMException ? lastError.name : "";
    const message = name === "NotAllowedError"
      ? "摄像头权限被拒绝，请在浏览器地址栏中允许摄像头权限。"
      : name === "NotFoundError" || name === "OverconstrainedError"
        ? "没有找到可用的 USB 摄像头，请检查连接后刷新设备。"
        : name === "NotReadableError"
          ? "摄像头正被其他程序占用，请关闭占用程序后重试。"
          : lastError instanceof Error
            ? lastError.message
            : "摄像头启动失败。";
    setCameraState("error");
    setError(message);
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const link = document.createElement("a");
    link.download = `${cameraConfig.filePrefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
    link.href = canvas.toDataURL("image/jpeg", 0.92);
    link.click();
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || cameraState !== "live") return;
    if (typeof MediaRecorder === "undefined") {
      setError("当前浏览器不支持视频录制，请升级 Edge 或 Chrome。");
      return;
    }

    const mimeType = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      setError("当前浏览器没有可用的 WebM 视频编码器。");
      return;
    }

    try {
      recordingChunksRef.current = [];
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 4_000_000,
      });
      recorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data);
      });
      recorder.addEventListener("error", () => {
        setRecording(false);
        setError("视频录制过程中发生错误，请重新启动摄像头后重试。");
      });
      recorder.addEventListener("stop", () => {
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        recorderRef.current = null;
        setRecording(false);
        if (recordingTimerRef.current) {
          window.clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        if (chunks.length === 0) return;

        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `${cameraConfig.filePrefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
        link.href = url;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      }, { once: true });

      setError("");
      setRecordingSeconds(0);
      setRecording(true);
      recorder.start(1000);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((seconds) => seconds + 1);
      }, 1000);
    } catch (recordingError) {
      setRecording(false);
      setError(recordingError instanceof Error ? recordingError.message : "视频录制启动失败。");
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }

  function requestFullscreen() {
    previewRef.current?.requestFullscreen?.();
  }

  const live = cameraState === "live";
  const objectMapping = recognizedObjectsToFishMapping(
    recognizedObjects,
    videoRef.current?.videoWidth ?? 0,
    videoRef.current?.videoHeight ?? 0,
  );
  const recognitionMappingActive = objectDetectionEnabled
    && detectorState === "running"
    && recognizedObjects.length > 0;
  const mappedObservations = detectedFishDensity !== undefined
    ? []
    : recognitionMappingActive
      ? objectMapping.observations
      : visionFrame.observations;
  const mappingActive = detectedFishDensity !== undefined || live;
  const incomingFishDensity = detectedFishDensity ?? (
    live
      ? recognitionMappingActive
        ? objectMapping.density
        : visionFrame.density
      : 0
  );
  const normalizedFishDensity = Number.isFinite(incomingFishDensity)
    ? Math.min(100, Math.max(0, incomingFishDensity))
    : 0;
  const fishCount = fishCountFromDensity(normalizedFishDensity);
  const densityLevel = normalizedFishDensity < 34 ? "稀疏" : normalizedFishDensity < 68 ? "适中" : "密集";
  const densitySourceLabel = detectedFishDensity === undefined
    ? live
      ? recognitionMappingActive
        ? "目标识别映射"
        : "运动视觉映射"
      : "等待摄像头"
    : densitySource === "sonar"
      ? "声呐实时数据"
      : "摄像头识别";
  const statusLabel = viewMode === "fish-3d"
    ? mappingActive
      ? "画面实时映射中"
      : "等待摄像头"
    : cameraState === "requesting"
      ? "正在连接"
      : live
        ? "实时画面"
        : cameraState === "error"
          ? "连接异常"
          : "等待连接";
  const detectorStatusLabel = !objectDetectionEnabled
    ? "已关闭"
    : detectorState === "loading"
      ? "正在加载模型"
      : detectorState === "running"
        ? `${recognizedObjects.length} 个目标`
        : detectorState === "error"
          ? "模型异常"
          : "等待摄像头";
  const recordingTimeLabel = `${String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:${String(recordingSeconds % 60).padStart(2, "0")}`;

  if (embedded) {
    return (
      <div ref={previewRef} className="absolute inset-0 overflow-hidden bg-[#061820]">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className={`pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
            live ? "opacity-100" : "opacity-0"
          }`}
        />
        <canvas
          ref={detectionCanvasRef}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 z-10 h-full w-full object-contain transition-opacity duration-300 ${
            live && objectDetectionEnabled ? "opacity-100" : "opacity-0"
          }`}
        />

        {!live ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-[radial-gradient(circle_at_center,rgba(27,107,120,0.3),transparent_62%)] p-3 text-center">
            <div className="w-full max-w-[250px]">
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 text-cyan-200 sm:h-14 sm:w-14">
                {cameraState === "requesting"
                  ? <RefreshCw className="h-5 w-5 animate-spin sm:h-6 sm:w-6" />
                  : <CameraOff className="h-5 w-5 sm:h-6 sm:w-6" />}
              </span>
              <strong className="mt-2 block text-xs text-white sm:mt-3 sm:text-sm">
                {cameraState === "requesting"
                  ? "正在连接摄像头"
                  : cameraState === "error"
                    ? "摄像头连接异常"
                    : "摄像头尚未启动"}
              </strong>
              {cameraState === "error" && error ? (
                <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-rose-300 sm:text-[10px]">
                  {error}
                </p>
              ) : null}
              {cameraState !== "requesting" ? (
                <>
                  <select
                    aria-label={cameraConfig.selectLabel}
                    value={selectedDeviceId}
                    onChange={(event) => selectCameraDevice(event.target.value)}
                    className="mt-2 h-8 w-full rounded-lg border border-white/10 bg-slate-950/75 px-2 text-[9px] font-semibold text-slate-200 outline-none sm:mt-3 sm:text-[10px]"
                  >
                    {devices.length === 0 ? (
                      <option value="">{cameraConfig.defaultDeviceLabel}</option>
                    ) : null}
                    {devices.map((device, index) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `摄像头 ${index + 1}`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void startCamera()}
                    disabled={!secureContext || !mediaSupported}
                    className="mt-2 inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg bg-cyan-400 px-3 text-[10px] font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Video className="h-3.5 w-3.5" />
                    {cameraState === "error" ? "重新连接" : "启动画面"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={cancelCameraRequest}
                  className="mt-3 inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 text-[10px] font-semibold text-slate-200 transition hover:bg-white/10"
                >
                  <CameraOff className="h-3.5 w-3.5" />
                  取消并刷新
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="pointer-events-none absolute left-2 top-2 z-30 flex flex-col items-start gap-1 sm:left-3 sm:top-3">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-950/65 px-2 py-1 text-[8px] font-semibold text-white backdrop-blur sm:text-[9px]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                LIVE
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-950/65 px-2 py-1 text-[8px] font-semibold text-cyan-100 backdrop-blur sm:text-[9px]">
                {detectorState === "loading"
                  ? <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                  : <span className={`h-1.5 w-1.5 rounded-full ${detectorState === "running" ? "animate-pulse bg-cyan-300" : "bg-slate-400"}`} />}
                AI {detectorStatusLabel}
              </span>
            </div>

            <div className="absolute right-2 top-2 z-30 flex items-center gap-1 sm:right-3 sm:top-3">
              <button
                type="button"
                onClick={captureFrame}
                className="grid h-7 w-7 place-items-center rounded-md bg-slate-950/65 text-slate-100 backdrop-blur transition hover:bg-cyan-500 hover:text-slate-950"
                title="截图"
                aria-label="截图"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={requestFullscreen}
                className="grid h-7 w-7 place-items-center rounded-md bg-slate-950/65 text-slate-100 backdrop-blur transition hover:bg-cyan-500 hover:text-slate-950"
                title="全屏"
                aria-label="全屏"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={stopCamera}
                className="grid h-7 w-7 place-items-center rounded-md bg-slate-950/65 text-slate-100 backdrop-blur transition hover:bg-rose-500"
                title="停止摄像头"
                aria-label="停止摄像头"
              >
                <CameraOff className="h-3.5 w-3.5" />
              </button>
            </div>

            <span className="pointer-events-none absolute bottom-2 left-2 z-30 rounded-md bg-slate-950/65 px-2 py-1 text-[8px] font-semibold text-white backdrop-blur sm:bottom-3 sm:left-3 sm:text-[9px]">
              {resolution}
            </span>
            {trackingEnabled ? (
              <span className={`pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2 rounded-md border px-2 py-1 text-[8px] font-semibold shadow-[0_0_16px_rgba(34,211,238,0.28)] backdrop-blur sm:bottom-3 sm:text-[9px] ${
                trackingSelection.safetyBlocked
                  ? "border-red-200/40 bg-red-500/90 text-white"
                  : "border-cyan-200/25 bg-cyan-400/85 text-slate-950"
              }`}>
                {trackingSelection.safetyBlocked
                  ? "AUTO · 人员邻近，暂停"
                  : trackingObservation
                    ? `AUTO · ${trackingObservation.label} ${Math.round(trackingObservation.score * 100)}%`
                    : `AUTO · 搜索${trackingProfile === "trash" ? "水面垃圾" : "瓶子"}`}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setObjectDetectionEnabled((enabled) => !enabled)}
              className={`absolute bottom-2 right-2 z-30 rounded-md px-2 py-1 text-[8px] font-semibold backdrop-blur transition sm:bottom-3 sm:right-3 sm:text-[9px] ${
                objectDetectionEnabled
                  ? "bg-cyan-400/85 text-slate-950"
                  : "bg-slate-950/65 text-slate-300"
              }`}
            >
              目标识别 {objectDetectionEnabled ? "开" : "关"}
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-[28px] border border-app-line bg-white shadow-soft">
      <div className="flex flex-col gap-4 border-b border-app-line px-5 py-5 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-harbor-100 text-harbor-600">
            <Camera className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-ink-900">船载摄像头与鱼群观测</h2>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl bg-app-subtle p-1">
            <button
              type="button"
              onClick={() => setViewMode("camera")}
              className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition ${
                viewMode === "camera" ? "bg-white text-harbor-700 shadow-sm" : "text-ink-500 hover:text-ink-700"
              }`}
            >
              <Camera className="h-3.5 w-3.5" />
              实时摄像头
            </button>
            <button
              type="button"
              onClick={() => setViewMode("fish-3d")}
              className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold transition ${
                viewMode === "fish-3d" ? "bg-white text-harbor-700 shadow-sm" : "text-ink-500 hover:text-ink-700"
              }`}
            >
              <Waves className="h-3.5 w-3.5" />
              鱼群 3D
            </button>
          </div>
          <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
            (viewMode === "fish-3d" && mappingActive) || live
              ? "bg-sage-100 text-sage-500"
              : cameraState === "error"
                ? "bg-red-50 text-red-600"
                : "bg-app-subtle text-ink-500"
          }`}>
            <i className={`h-2 w-2 rounded-full ${
              (viewMode === "fish-3d" && mappingActive) || live
                ? "animate-pulse bg-sage-500"
                : cameraState === "error"
                  ? "bg-red-500"
                  : "bg-ink-400"
            }`} />
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.55fr)_360px]">
        <div ref={previewRef} className="relative aspect-video min-h-[280px] overflow-hidden bg-[#081c24]">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className={`pointer-events-none absolute object-contain transition-all duration-300 ${
              viewMode === "camera"
                ? `inset-0 h-full w-full ${live ? "opacity-100" : "opacity-0"}`
                : live
                  ? "bottom-4 left-4 z-20 h-24 w-40 rounded-xl border border-cyan-100/30 bg-slate-950/80 opacity-90 shadow-2xl"
                  : "inset-0 h-full w-full opacity-0"
            }`}
          />
          <canvas
            ref={detectionCanvasRef}
            aria-hidden="true"
            className={`pointer-events-none absolute object-contain transition-all duration-300 ${
              !live || !objectDetectionEnabled
                ? "inset-0 h-full w-full opacity-0"
                : viewMode === "camera"
                  ? "inset-0 z-10 h-full w-full opacity-100"
                  : "bottom-4 left-4 z-30 h-24 w-40 opacity-100"
            }`}
          />
          {viewMode === "camera" && !live ? (
            <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_center,rgba(27,107,120,0.24),transparent_58%)] px-6 text-center">
              <div>
                <span className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-white/10 bg-white/5 text-cyan-200">
                  {cameraState === "requesting" ? <RefreshCw className="h-7 w-7 animate-spin" /> : <CameraOff className="h-7 w-7" />}
                </span>
                <strong className="mt-4 block text-base text-white">
                  {cameraState === "requesting"
                    ? "正在连接摄像头"
                    : cameraState === "error"
                      ? "摄像头连接异常"
                      : "摄像头尚未启动"}
                </strong>
                <p className={`mt-2 max-w-md text-xs leading-5 ${cameraState === "error" ? "text-rose-300" : "text-slate-400"}`}>
                  {cameraState === "requesting"
                    ? `正在等待“${selectedCameraName}”返回画面，若长时间无响应会自动停止并显示原因。`
                    : cameraState === "error" && error
                      ? error
                      : "选择摄像头后启动实时画面"}
                </p>
                {cameraState === "requesting" ? (
                  <button
                    type="button"
                    onClick={cancelCameraRequest}
                    className="mt-4 inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
                  >
                    <CameraOff className="h-4 w-4" />
                    取消并刷新
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {viewMode === "camera" && live ? (
            <>
              <span className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-lg bg-slate-950/55 px-2.5 py-1.5 text-[10px] font-semibold text-white backdrop-blur">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                LIVE
              </span>
              <span className="absolute left-4 top-14 z-20 inline-flex items-center gap-2 rounded-lg bg-slate-950/55 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-100 backdrop-blur">
                {detectorState === "loading" ? <RefreshCw className="h-3 w-3 animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${detectorState === "running" ? "animate-pulse bg-cyan-300" : "bg-slate-400"}`} />}
                AI {detectorStatusLabel}
                {inferenceMs > 0 ? ` · ${Math.round(inferenceMs)} ms` : ""}
              </span>
              {recording ? (
                <span className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-lg bg-red-600/85 px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-[0_8px_24px_rgba(220,38,38,0.24)] backdrop-blur">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  REC {recordingTimeLabel}
                </span>
              ) : null}
              <span className="absolute bottom-4 left-4 rounded-lg bg-slate-950/55 px-2.5 py-1.5 text-[10px] font-semibold text-white backdrop-blur">
                {resolution}
              </span>
            </>
          ) : null}
          <div className={`absolute inset-0 z-0 transition-opacity duration-300 ${
            viewMode === "fish-3d" ? "opacity-100" : "pointer-events-none opacity-0"
          }`}>
            <UnderwaterFishScene
              density={normalizedFishDensity}
              observations={mappedObservations}
              active={viewMode === "fish-3d"}
            />
            <div className="pointer-events-none absolute inset-0">
              <span className="absolute left-4 top-4 inline-flex items-center gap-2 rounded-lg border border-cyan-200/15 bg-slate-950/45 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-50 backdrop-blur">
                <span className={`h-1.5 w-1.5 rounded-full ${mappingActive ? "animate-pulse bg-cyan-300" : "bg-slate-400"}`} />
                3D MAPPING · {densitySourceLabel}
              </span>
              <span className="absolute right-4 top-4 rounded-lg border border-cyan-200/15 bg-slate-950/45 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-50 backdrop-blur">
                鱼群密度 {Math.round(normalizedFishDensity)}% · {densityLevel}
              </span>
              <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-cyan-200/10 bg-slate-950/45 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-50/90 backdrop-blur">
                鼠标拖动旋转 · 滚轮缩放
              </span>
              <span className="absolute bottom-4 right-4 rounded-lg border border-cyan-200/10 bg-slate-950/45 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-50/90 backdrop-blur">
                InstancedMesh · {fishCount} 条
              </span>
            </div>
          </div>
        </div>

        <aside className="border-t border-app-line p-5 lg:border-l lg:border-t-0 lg:p-6">
          {viewMode === "camera" ? (
            <>
              <label htmlFor={cameraDeviceSelectId} className="text-xs font-semibold text-ink-500">{cameraConfig.selectLabel}</label>
          <select
            id={cameraDeviceSelectId}
            value={selectedDeviceId}
            onChange={(event) => selectCameraDevice(event.target.value)}
            disabled={cameraState === "requesting"}
            className="mt-2 w-full rounded-xl border border-app-line bg-app-subtle px-3 py-3 text-sm font-semibold text-ink-900 outline-none transition focus:border-harbor-400"
          >
            {devices.length === 0 ? (
              <option value="">{cameraConfig.defaultDeviceLabel}</option>
            ) : null}
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `摄像头 ${index + 1}`}
              </option>
            ))}
          </select>

          <div className="mt-4 rounded-xl border border-app-line bg-app-subtle p-3">
            <div className="flex items-center justify-between gap-3">
              <strong className="block text-xs text-ink-900">AI 目标识别</strong>
              <button
                type="button"
                role="switch"
                aria-checked={objectDetectionEnabled}
                onClick={() => setObjectDetectionEnabled((enabled) => !enabled)}
                className={`relative h-7 w-12 rounded-full transition ${
                  objectDetectionEnabled ? "bg-harbor-600" : "bg-ink-300"
                }`}
              >
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${
                  objectDetectionEnabled ? "left-6" : "left-1"
                }`} />
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void startCamera()}
              disabled={cameraState === "requesting" || !secureContext || !mediaSupported}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-harbor-600 px-3 text-sm font-semibold text-white transition hover:bg-harbor-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Video className="h-4 w-4" />
              {live ? "重新连接" : "启动画面"}
            </button>
            <button
              type="button"
              onClick={cameraState === "requesting" ? cancelCameraRequest : stopCamera}
              disabled={!live && cameraState !== "requesting"}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-app-line bg-white px-3 text-sm font-semibold text-ink-700 transition hover:border-harbor-300 hover:text-harbor-600 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <CameraOff className="h-4 w-4" />
              {cameraState === "requesting" ? "取消并刷新" : "停止"}
            </button>
            <button
              type="button"
              onClick={captureFrame}
              disabled={!live}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-app-line bg-white px-3 text-sm font-semibold text-ink-700 transition hover:border-harbor-300 hover:text-harbor-600 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Download className="h-4 w-4" />
              截图
            </button>
            <button
              type="button"
              onClick={requestFullscreen}
              disabled={!live}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-app-line bg-white px-3 text-sm font-semibold text-ink-700 transition hover:border-harbor-300 hover:text-harbor-600 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Maximize2 className="h-4 w-4" />
              全屏
            </button>
          </div>

          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={!live}
            className={`mt-3 inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${
              recording
                ? "bg-red-600 text-white shadow-[0_10px_28px_rgba(220,38,38,0.2)] hover:bg-red-700"
                : "border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
            }`}
          >
            {recording ? <Square className="h-4 w-4 fill-current" /> : <Circle className="h-4 w-4 fill-current" />}
            {recording ? `停止并保存 ${recordingTimeLabel}` : "开始录制视频"}
          </button>

          <button
            type="button"
            onClick={() => void refreshDevices()}
            className="mt-3 inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-xl bg-app-subtle px-3 text-xs font-semibold text-ink-500 transition hover:text-harbor-600"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重新扫描 USB 摄像头
          </button>

          {!secureContext ? (
            <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-600">当前不是安全页面。请在摄像头所在电脑使用 `http://localhost:3000`，或为平台配置 HTTPS。</p>
          ) : null}
          {!mediaSupported ? (
            <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-600">浏览器不支持 MediaDevices，请升级 Edge 或 Chrome。</p>
          ) : null}
          {error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-600">{error}</p> : null}

            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-ink-500">鱼群密度</p>
                  <strong className="mt-1 block text-2xl font-semibold text-ink-900">
                    {Math.round(normalizedFishDensity)}%
                  </strong>
                </div>
                <span className="rounded-full bg-harbor-100 px-3 py-1.5 text-xs font-semibold text-harbor-700">
                  {densityLevel}
                </span>
              </div>

              {detectedFishDensity === undefined ? (
                <div className="mt-4 rounded-xl border border-app-line bg-app-subtle p-3">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <label htmlFor="fish-vision-sensitivity" className="text-ink-500">视觉灵敏度</label>
                    <span className="text-harbor-700">{visionSensitivity}%</span>
                  </div>
                  <input
                    id="fish-vision-sensitivity"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={visionSensitivity}
                    onChange={(event) => setVisionSensitivity(Number(event.target.value))}
                    className="mt-3 w-full accent-[#0f7f8a]"
                  />
                  <div className="mt-1 flex justify-between text-[10px] font-semibold text-ink-400">
                    <span>稳定</span>
                    <span>均衡</span>
                    <span>灵敏</span>
                  </div>
                </div>
              ) : null}

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-app-subtle p-3">
                  <span className="text-[10px] font-semibold text-ink-400">估算鱼数</span>
                  <strong className="mt-1 block text-sm text-ink-900">{fishCount} 条</strong>
                </div>
                <div className="rounded-xl bg-app-subtle p-3">
                  <span className="text-[10px] font-semibold text-ink-400">映射目标</span>
                  <strong className="mt-1 block text-sm text-ink-900">
                    {recognitionMappingActive ? recognizedObjects.length : visionFrame.observations.length} 个
                  </strong>
                </div>
                <div className="rounded-xl bg-app-subtle p-3">
                  <span className="text-[10px] font-semibold text-ink-400">画面运动</span>
                  <strong className="mt-1 block text-sm text-ink-900">{(visionFrame.motionRatio * 100).toFixed(1)}%</strong>
                </div>
                <div className="rounded-xl bg-app-subtle p-3">
                  <span className="text-[10px] font-semibold text-ink-400">映射状态</span>
                  <strong className={`mt-1 block text-sm ${mappingActive ? "text-sage-500" : "text-ink-500"}`}>
                    {detectorState === "loading" ? "模型加载中" : mappingActive ? densitySourceLabel : "等待视频"}
                  </strong>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  disabled={cameraState === "requesting" || !secureContext || !mediaSupported}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-harbor-600 px-3 text-sm font-semibold text-white transition hover:bg-harbor-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {cameraState === "requesting" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                  {live ? "重新连接" : "启动映射"}
                </button>
                <button
                  type="button"
                  onClick={requestFullscreen}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-app-line bg-white px-3 text-sm font-semibold text-ink-700 transition hover:border-harbor-300 hover:text-harbor-600"
                >
                  <Maximize2 className="h-4 w-4" />
                  全屏观察
                </button>
              </div>

              {error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-600">{error}</p> : null}

              <div className="mt-4 rounded-xl bg-harbor-50 p-3 text-xs leading-5 text-harbor-700">
                AI 模型识别到目标时，识别框会优先驱动三维鱼群数量和位置；暂时没有识别结果时，系统会自动回退到运动区域映射，保持画面连续。
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function selectAutoTrackingObservation(
  objects: RecognizedObject[],
  frameWidth: number,
  frameHeight: number,
  profile: CameraTrackingProfile,
  previousObservation: CameraTrackingObservation | null,
): { observation: CameraTrackingObservation | null; safetyBlocked: boolean } {
  const normalizedProfile = normalizeTrackingProfile(profile);
  const allowedClasses = TRACKING_PROFILE_CLASSES[normalizedProfile];
  const acquireScore = TRACKING_PROFILE_ACQUIRE_SCORE[normalizedProfile];
  const maintainScore = TRACKING_PROFILE_MAINTAIN_SCORE[normalizedProfile];
  const minimumAreaRatio = TRACKING_PROFILE_MINIMUM_AREA_RATIO[normalizedProfile];
  const people = objects.filter((object) => (
    object.className.toLowerCase() === "person"
    && object.score >= PERSON_SAFETY_MINIMUM_SCORE
  ));
  const now = Date.now();
  const activePrevious = previousObservation
    && now - previousObservation.timestamp <= TRACKING_LOCK_MAX_AGE_MS
    ? previousObservation
    : null;
  const frameArea = Math.max(1, frameWidth * frameHeight);
  const profileCandidates = objects.flatMap((object) => {
    const className = object.className.toLowerCase();
    if (!allowedClasses.has(className)) return [];

    const [x, y, width, height] = object.bbox;
    if (width <= 0 || height <= 0) return [];
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const areaRatio = width * height / frameArea;
    if (areaRatio < minimumAreaRatio) return [];

    const matchesPreviousClass = activePrevious
      ? trackingClassesMatch(normalizedProfile, activePrevious.className, className)
      : false;
    const previousDistance = activePrevious && matchesPreviousClass
      ? Math.hypot(
          (centerX - activePrevious.centerX) / frameWidth,
          (centerY - activePrevious.centerY) / frameHeight,
        )
      : Number.POSITIVE_INFINITY;
    const maximumContinuationDistance = normalizedProfile === "bottle-test" ? 0.36 : 0.24;
    const continuesPreviousTarget = previousDistance < maximumContinuationDistance;
    const requiredScore = continuesPreviousTarget ? maintainScore : acquireScore;
    if (object.score < requiredScore) return [];

    return [{
      object,
      centerX,
      centerY,
      areaRatio,
      previousDistance,
      unsafe: people.some((person) => candidateIsNearPerson(object.bbox, person.bbox)),
    }];
  });
  const candidates = profileCandidates
    .filter((candidate) => !candidate.unsafe)
    .map(({ object, centerX, centerY, areaRatio: rawAreaRatio, previousDistance }) => {
      const [, , width, height] = object.bbox;
      const centerDistance = Math.hypot(
        (centerX - frameWidth / 2) / frameWidth,
        (centerY - frameHeight / 2) / frameHeight,
      );
      const areaRatio = Math.min(1, Math.sqrt(rawAreaRatio) * 4);
      const lockBonus = previousDistance < 0.28
        ? Math.max(0.25, 1.35 - previousDistance * 3.5)
        : 0;
      return {
        object,
        centerX,
        centerY,
        width,
        height,
        rank: object.score * 2 + areaRatio * 0.35 - centerDistance * 0.2 + lockBonus,
      };
    })
    .sort((left, right) => right.rank - left.rank);

  const selected = candidates[0];
  if (!selected) {
    return {
      observation: null,
      safetyBlocked: profileCandidates.some((candidate) => candidate.unsafe),
    };
  }

  return {
    observation: {
      className: selected.object.className,
      label: selected.object.label,
      score: selected.object.score,
      centerX: selected.centerX,
      centerY: selected.centerY,
      width: selected.width,
      height: selected.height,
      frameWidth,
      frameHeight,
      timestamp: now,
    },
    safetyBlocked: false,
  };
}

function trackingClassesMatch(
  profile: CameraTrackingProfile | string,
  leftClassName: string,
  rightClassName: string,
) {
  const left = leftClassName.toLowerCase();
  const right = rightClassName.toLowerCase();
  if (left === right) return true;
  if (normalizeTrackingProfile(profile) !== "bottle-test") return false;
  const bottleClasses = TRACKING_PROFILE_CLASSES["bottle-test"];
  return bottleClasses.has(left) && bottleClasses.has(right);
}

function candidateIsNearPerson(
  candidate: [number, number, number, number],
  person: [number, number, number, number],
) {
  const [candidateX, candidateY, candidateWidth, candidateHeight] = candidate;
  const [personX, personY, personWidth, personHeight] = person;
  const candidateCenterX = candidateX + candidateWidth / 2;
  const candidateCenterY = candidateY + candidateHeight / 2;
  const horizontalMargin = Math.max(20, personWidth * 0.18, candidateWidth * 0.3);
  const verticalMargin = Math.max(20, personHeight * 0.12, candidateHeight * 0.3);
  return candidateCenterX >= personX - horizontalMargin
    && candidateCenterX <= personX + personWidth + horizontalMargin
    && candidateCenterY >= personY - verticalMargin
    && candidateCenterY <= personY + personHeight + verticalMargin;
}
