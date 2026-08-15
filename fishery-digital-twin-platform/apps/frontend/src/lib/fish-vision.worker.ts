import {
  createFishFrameAnalyzer,
  type FishAnalysisRequest,
  type FishAnalysisResult,
  type FishVisionFrame,
} from "./fish-vision";

// The analyzer holds frame-to-frame state (previous gray frame, smoothed
// density, retained observations), so exactly one instance lives for the
// lifetime of this worker. The main thread only sends raw pixels and receives
// the computed FishVisionFrame, keeping the BFS flood fill off the UI thread.
const analyzer = createFishFrameAnalyzer();

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<FishAnalysisRequest>) => void) | null;
  postMessage: (message: FishAnalysisResult) => void;
};

workerScope.onmessage = (event: MessageEvent<FishAnalysisRequest>) => {
  const message = event.data;
  if (!message || message.type !== "analyze") return;

  const frame: FishVisionFrame | null = analyzer.analyze(message.pixels, message.sensitivity);
  if (!frame) return;

  workerScope.postMessage({ type: "result", frame, frameId: message.frameId });
};
