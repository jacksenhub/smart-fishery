import type {
  BrowserObjectDetector,
  ObjectDetectionResult,
  RecognizedObject,
} from "@/lib/object-detector";

const INPUT_SIZE = 640;
// Served from public/models so detection works fully offline (no external
// CDN/HuggingFace dependency). Override with NEXT_PUBLIC_YOLO_MODEL_URL.
const DEFAULT_MODEL_URL = "/models/yolo26n.onnx";

const COCO_CLASSES = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
  "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
  "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard",
  "tennis racket", "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
  "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
  "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone",
  "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
  "hair drier", "toothbrush",
] as const;

interface ModelBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  classIndex: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function halfToFloat(value: number) {
  const sign = value & 0x8000 ? -1 : 1;
  const exponent = value >> 10 & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function tensorValues(
  data: Float32Array | Float64Array | Uint16Array | readonly number[],
  dataType: string,
) {
  if (dataType !== "float16") return (index: number) => Number(data[index]);
  return (index: number) => halfToFloat(Number(data[index]));
}

function intersectionOverUnion(left: ModelBox, right: ModelBox) {
  const overlapWidth = Math.max(0, Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1));
  const overlapHeight = Math.max(0, Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1));
  const intersection = overlapWidth * overlapHeight;
  const leftArea = Math.max(0, left.x2 - left.x1) * Math.max(0, left.y2 - left.y1);
  const rightArea = Math.max(0, right.x2 - right.x1) * Math.max(0, right.y2 - right.y1);
  return intersection / Math.max(1e-6, leftArea + rightArea - intersection);
}

function nonMaximumSuppression(boxes: ModelBox[], maximumBoxes: number) {
  const candidates = [...boxes].sort((left, right) => right.score - left.score);
  const selected: ModelBox[] = [];
  while (candidates.length > 0 && selected.length < maximumBoxes) {
    const candidate = candidates.shift();
    if (!candidate) break;
    selected.push(candidate);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      if (
        candidates[index].classIndex === candidate.classIndex
        && intersectionOverUnion(candidate, candidates[index]) > 0.45
      ) {
        candidates.splice(index, 1);
      }
    }
  }
  return selected;
}

function decodeOutput(
  data: Float32Array | Float64Array | Uint16Array | readonly number[],
  dataType: string,
  dimensions: readonly number[],
  minimumScore: number,
) {
  const valueAt = tensorValues(data, dataType);
  const boxes: ModelBox[] = [];

  if (dimensions.length === 3 && dimensions[2] === 6) {
    const rowCount = dimensions[1];
    for (let row = 0; row < rowCount; row += 1) {
      const offset = row * 6;
      const score = valueAt(offset + 4);
      if (score < minimumScore) continue;
      boxes.push({
        x1: valueAt(offset),
        y1: valueAt(offset + 1),
        x2: valueAt(offset + 2),
        y2: valueAt(offset + 3),
        score,
        classIndex: Math.round(valueAt(offset + 5)),
      });
    }
    return boxes;
  }

  if (dimensions.length !== 3) return boxes;
  const channelsFirst = dimensions[1] < dimensions[2];
  const candidateCount = channelsFirst ? dimensions[2] : dimensions[1];
  const channelCount = channelsFirst ? dimensions[1] : dimensions[2];
  if (channelCount < 5) return boxes;
  const read = (candidate: number, channel: number) => (
    channelsFirst
      ? valueAt(channel * candidateCount + candidate)
      : valueAt(candidate * channelCount + channel)
  );

  for (let candidate = 0; candidate < candidateCount; candidate += 1) {
    let bestScore = 0;
    let bestClassIndex = 0;
    for (let classIndex = 0; classIndex < channelCount - 4; classIndex += 1) {
      const score = read(candidate, classIndex + 4);
      if (score > bestScore) {
        bestScore = score;
        bestClassIndex = classIndex;
      }
    }
    if (bestScore < minimumScore) continue;
    const centerX = read(candidate, 0);
    const centerY = read(candidate, 1);
    const width = read(candidate, 2);
    const height = read(candidate, 3);
    boxes.push({
      x1: centerX - width / 2,
      y1: centerY - height / 2,
      x2: centerX + width / 2,
      y2: centerY + height / 2,
      score: bestScore,
      classIndex: bestClassIndex,
    });
  }
  return boxes;
}

export async function loadYolo26Detector(): Promise<BrowserObjectDetector> {
  const configuredModelUrl = process.env.NEXT_PUBLIC_YOLO_MODEL_URL?.trim();
  const configuredClassNames = process.env.NEXT_PUBLIC_YOLO_CLASS_NAMES
    ?.split(",")
    .map((className) => className.trim())
    .filter(Boolean);
  const classNames: readonly string[] = configuredClassNames?.length ? configuredClassNames : COCO_CLASSES;
  const modelUrl = configuredModelUrl || DEFAULT_MODEL_URL;
  const createRuntime = async () => {
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      try {
        const webGpuOrt = await import("onnxruntime-web/webgpu");
        // WebGPU intentionally leaves shape-related operations on the CPU. ORT
        // reports that expected scheduling choice as a warning, which Next.js
        // promotes to a development error overlay even though inference works.
        webGpuOrt.env.logLevel = "error";
        const webGpuSession = await webGpuOrt.InferenceSession.create(modelUrl, {
          executionProviders: ["webgpu"],
          graphOptimizationLevel: "all",
          logSeverityLevel: 3,
        });
        return { ort: webGpuOrt, session: webGpuSession, backend: "ONNX WebGPU" };
      } catch {
        // Unsupported GPUs/operators fall through to the broadly compatible
        // WASM runtime instead of disabling recognition.
      }
    }

    const wasmOrt = await import("onnxruntime-web/wasm");
    wasmOrt.env.logLevel = "error";
    wasmOrt.env.wasm.numThreads = 1;
    const configuredWasmPath = process.env.NEXT_PUBLIC_ONNX_WASM_PATH?.trim();
    if (configuredWasmPath) wasmOrt.env.wasm.wasmPaths = configuredWasmPath;
    const wasmSession = await wasmOrt.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      logSeverityLevel: 3,
    });
    return { ort: wasmOrt, session: wasmSession, backend: "ONNX WASM" };
  };
  const { ort, session, backend } = await createRuntime();
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    session.release();
    throw new Error("YOLO26 模型缺少输入或输出节点。");
  }

  const canvas = document.createElement("canvas");
  canvas.width = INPUT_SIZE;
  canvas.height = INPUT_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    session.release();
    throw new Error("浏览器无法创建 YOLO 图像预处理画布。");
  }
  const inputValues = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);

  return {
    backend,
    modelName: configuredModelUrl ? "YOLO26n 专用模型" : "YOLO26n ONNX",
    async detect(video, minimumScore, maximumBoxes = 20): Promise<ObjectDetectionResult> {
      const startedAt = performance.now();
      const scale = Math.min(INPUT_SIZE / video.videoWidth, INPUT_SIZE / video.videoHeight);
      const scaledWidth = Math.round(video.videoWidth * scale);
      const scaledHeight = Math.round(video.videoHeight * scale);
      const paddingX = Math.floor((INPUT_SIZE - scaledWidth) / 2);
      const paddingY = Math.floor((INPUT_SIZE - scaledHeight) / 2);

      context.fillStyle = "#727272";
      context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
      context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight, paddingX, paddingY, scaledWidth, scaledHeight);
      const pixels = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
      const planeSize = INPUT_SIZE * INPUT_SIZE;
      for (let pixel = 0; pixel < planeSize; pixel += 1) {
        const source = pixel * 4;
        inputValues[pixel] = pixels[source] / 255;
        inputValues[planeSize + pixel] = pixels[source + 1] / 255;
        inputValues[planeSize * 2 + pixel] = pixels[source + 2] / 255;
      }

      const inputTensor = new ort.Tensor("float32", inputValues, [1, 3, INPUT_SIZE, INPUT_SIZE]);
      const outputs = await session.run({ [inputName]: inputTensor });
      const output = outputs[outputName];
      if (!output) throw new Error("YOLO26 未返回检测结果。");
      const decoded = decodeOutput(
        output.data as Float32Array | Float64Array | Uint16Array | readonly number[],
        output.type,
        output.dims,
        minimumScore,
      );
      const selected = nonMaximumSuppression(decoded, maximumBoxes);
      const objects: RecognizedObject[] = selected.map((box) => {
        const normalizedCoordinates = Math.max(box.x1, box.y1, box.x2, box.y2) <= 2;
        const coordinateScale = normalizedCoordinates ? INPUT_SIZE : 1;
        const x1 = clamp((box.x1 * coordinateScale - paddingX) / scale, 0, video.videoWidth);
        const y1 = clamp((box.y1 * coordinateScale - paddingY) / scale, 0, video.videoHeight);
        const x2 = clamp((box.x2 * coordinateScale - paddingX) / scale, 0, video.videoWidth);
        const y2 = clamp((box.y2 * coordinateScale - paddingY) / scale, 0, video.videoHeight);
        const className = classNames[box.classIndex] ?? `class-${box.classIndex}`;
        return {
          bbox: [x1, y1, Math.max(0, x2 - x1), Math.max(0, y2 - y1)] as [number, number, number, number],
          className,
          label: className,
          score: box.score,
        };
      }).filter((object) => object.bbox[2] >= 2 && object.bbox[3] >= 2);

      return {
        objects,
        inferenceMs: performance.now() - startedAt,
      };
    },
    dispose() {
      session.release();
    },
  };
}
