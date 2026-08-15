export interface FishObservation {
  x: number;
  y: number;
  size: number;
  confidence: number;
}

export interface FishVisionFrame {
  density: number;
  observations: FishObservation[];
  motionRatio: number;
  timestamp: number;
}

export interface FishFrameAnalyzer {
  analyze(pixels: Uint8ClampedArray, sensitivity: number): FishVisionFrame | null;
  reset(): void;
}

export interface FishAnalysisRequest {
  type: "analyze";
  pixels: Uint8ClampedArray;
  sensitivity: number;
  frameId: number;
}

export interface FishAnalysisResult {
  type: "result";
  frame: FishVisionFrame;
  frameId: number;
}

export const ANALYSIS_WIDTH = 160;
export const ANALYSIS_HEIGHT = 90;
const PIXEL_COUNT = ANALYSIS_WIDTH * ANALYSIS_HEIGHT;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function createFishFrameAnalyzer(): FishFrameAnalyzer {
  let previousGray: Uint8Array | null = null;
  let smoothedDensity = 0;
  let retainedObservations: FishObservation[] = [];

  const gray = new Uint8Array(PIXEL_COUNT);
  const motionMask = new Uint8Array(PIXEL_COUNT);
  const cleanedMask = new Uint8Array(PIXEL_COUNT);
  const visited = new Uint8Array(PIXEL_COUNT);
  const queue = new Int32Array(PIXEL_COUNT);

  function reset() {
    previousGray = null;
    smoothedDensity = 0;
    retainedObservations = [];
    motionMask.fill(0);
    cleanedMask.fill(0);
    visited.fill(0);
  }

  function analyze(pixels: Uint8ClampedArray, sensitivity: number): FishVisionFrame | null {
    if (pixels.length < PIXEL_COUNT * 4) {
      return null;
    }

    const frame = pixels;
    for (let index = 0; index < PIXEL_COUNT; index += 1) {
      const offset = index * 4;
      gray[index] = (frame[offset] * 77 + frame[offset + 1] * 150 + frame[offset + 2] * 29) >> 8;
    }

    if (!previousGray) {
      previousGray = new Uint8Array(gray);
      return {
        density: 0,
        observations: [],
        motionRatio: 0,
        timestamp: performance.now(),
      };
    }

    const normalizedSensitivity = clamp(sensitivity, 0, 100);
    const differenceThreshold = Math.round(47 - normalizedSensitivity * 0.29);
    motionMask.fill(0);
    cleanedMask.fill(0);
    visited.fill(0);

    for (let y = 2; y < ANALYSIS_HEIGHT - 2; y += 1) {
      for (let x = 2; x < ANALYSIS_WIDTH - 2; x += 1) {
        const index = y * ANALYSIS_WIDTH + x;
        const difference = Math.abs(gray[index] - previousGray[index]);
        if (difference >= differenceThreshold && gray[index] > 8) {
          motionMask[index] = 1;
        }
      }
    }

    for (let y = 2; y < ANALYSIS_HEIGHT - 2; y += 1) {
      for (let x = 2; x < ANALYSIS_WIDTH - 2; x += 1) {
        const index = y * ANALYSIS_WIDTH + x;
        if (!motionMask[index]) continue;
        const neighborCount = motionMask[index - 1]
          + motionMask[index + 1]
          + motionMask[index - ANALYSIS_WIDTH]
          + motionMask[index + ANALYSIS_WIDTH]
          + motionMask[index - ANALYSIS_WIDTH - 1]
          + motionMask[index - ANALYSIS_WIDTH + 1]
          + motionMask[index + ANALYSIS_WIDTH - 1]
          + motionMask[index + ANALYSIS_WIDTH + 1];
        if (neighborCount >= 2) cleanedMask[index] = 1;
      }
    }

    const minimumArea = Math.round(13 - normalizedSensitivity * 0.07);
    const maximumArea = PIXEL_COUNT * 0.22;
    const observations: Array<FishObservation & { area: number }> = [];
    let totalMotionPixels = 0;

    for (let start = 0; start < PIXEL_COUNT; start += 1) {
      if (!cleanedMask[start] || visited[start]) continue;

      let queueStart = 0;
      let queueEnd = 0;
      let area = 0;
      let sumX = 0;
      let sumY = 0;
      let minX = ANALYSIS_WIDTH;
      let maxX = 0;
      let minY = ANALYSIS_HEIGHT;
      let maxY = 0;
      queue[queueEnd] = start;
      queueEnd += 1;
      visited[start] = 1;

      while (queueStart < queueEnd) {
        const index = queue[queueStart];
        queueStart += 1;
        const x = index % ANALYSIS_WIDTH;
        const y = Math.floor(index / ANALYSIS_WIDTH);
        area += 1;
        sumX += x;
        sumY += y;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        const left = index - 1;
        const right = index + 1;
        const up = index - ANALYSIS_WIDTH;
        const down = index + ANALYSIS_WIDTH;
        if (x > 0 && cleanedMask[left] && !visited[left]) {
          visited[left] = 1;
          queue[queueEnd] = left;
          queueEnd += 1;
        }
        if (x < ANALYSIS_WIDTH - 1 && cleanedMask[right] && !visited[right]) {
          visited[right] = 1;
          queue[queueEnd] = right;
          queueEnd += 1;
        }
        if (y > 0 && cleanedMask[up] && !visited[up]) {
          visited[up] = 1;
          queue[queueEnd] = up;
          queueEnd += 1;
        }
        if (y < ANALYSIS_HEIGHT - 1 && cleanedMask[down] && !visited[down]) {
          visited[down] = 1;
          queue[queueEnd] = down;
          queueEnd += 1;
        }
      }

      if (area < minimumArea || area > maximumArea) continue;
      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      const aspectRatio = Math.max(width, height) / Math.max(1, Math.min(width, height));
      if (aspectRatio > 9.5) continue;

      totalMotionPixels += area;
      observations.push({
        x: (sumX / area / ANALYSIS_WIDTH - 0.5) * 2,
        y: (0.5 - sumY / area / ANALYSIS_HEIGHT) * 2,
        size: clamp(Math.sqrt(area) / 14, 0.28, 1.5),
        confidence: clamp(area / Math.max(1, minimumArea * 5), 0.28, 0.98),
        area,
      });
    }

    observations.sort((left, right) => right.area - left.area);
    const visibleObservations = observations.slice(0, 14).map((observation) => ({
      x: observation.x,
      y: observation.y,
      size: observation.size,
      confidence: observation.confidence,
    }));
    const motionRatio = totalMotionPixels / PIXEL_COUNT;
    const wholeFrameMovement = motionRatio > 0.34;
    const rawDensity = wholeFrameMovement
      ? Math.min(smoothedDensity, 18)
      : clamp(motionRatio * 430 + visibleObservations.length * 4.2, 0, 100);

    if (visibleObservations.length > 0 && !wholeFrameMovement) {
      retainedObservations = visibleObservations;
      smoothedDensity += (rawDensity - smoothedDensity) * 0.34;
    } else {
      retainedObservations = retainedObservations
        .map((observation) => ({ ...observation, confidence: observation.confidence * 0.9 }))
        .filter((observation) => observation.confidence >= 0.25);
      smoothedDensity *= 0.94;
    }

    previousGray.set(gray);
    return {
      density: clamp(smoothedDensity, 0, 100),
      observations: retainedObservations,
      motionRatio,
      timestamp: performance.now(),
    };
  }

  return { analyze, reset };
}
