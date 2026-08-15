import type { ObjectDetection } from "@tensorflow-models/coco-ssd";
import type { FishObservation } from "@/lib/fish-vision";

export interface RecognizedObject {
  bbox: [number, number, number, number];
  className: string;
  label: string;
  score: number;
}

export interface ObjectDetectionResult {
  objects: RecognizedObject[];
  inferenceMs: number;
}

export interface BrowserObjectDetector {
  backend: string;
  modelName: string;
  fallbackReason?: string;
  detect(video: HTMLVideoElement, minimumScore: number, maximumBoxes?: number): Promise<ObjectDetectionResult>;
  dispose(): void;
}

export type DetectorEngine = "yolo26" | "coco-ssd";

export interface DetectorLoadOptions {
  engine?: DetectorEngine;
}

export interface ObjectToFishMapping {
  density: number;
  observations: FishObservation[];
}

const CLASS_LABELS: Record<string, string> = {
  fish: "鱼",
  plastic_bottle: "塑料瓶",
  plastic_bag: "塑料袋",
  can: "易拉罐",
  foam: "泡沫",
  fishing_net: "渔网",
  branch: "树枝",
  aquatic_plant: "水草",
  other_trash: "其他垃圾",
  person: "人员",
  bicycle: "自行车",
  car: "汽车",
  motorcycle: "摩托车",
  airplane: "飞机",
  bus: "公交车",
  train: "火车",
  truck: "卡车",
  boat: "船只",
  "traffic light": "交通灯",
  "fire hydrant": "消防栓",
  "stop sign": "停止标志",
  "parking meter": "停车计时器",
  bench: "长椅",
  bird: "鸟",
  cat: "猫",
  dog: "狗",
  horse: "马",
  sheep: "羊",
  cow: "牛",
  elephant: "大象",
  bear: "熊",
  zebra: "斑马",
  giraffe: "长颈鹿",
  backpack: "背包",
  umbrella: "雨伞",
  handbag: "手提包",
  tie: "领带",
  suitcase: "行李箱",
  frisbee: "飞盘",
  skis: "滑雪板",
  snowboard: "单板滑雪板",
  "sports ball": "球",
  kite: "风筝",
  "baseball bat": "棒球棒",
  "baseball glove": "棒球手套",
  skateboard: "滑板",
  surfboard: "冲浪板",
  "tennis racket": "网球拍",
  bottle: "瓶子",
  "wine glass": "酒杯",
  cup: "杯子",
  fork: "叉子",
  knife: "刀具",
  spoon: "勺子",
  bowl: "碗",
  banana: "香蕉",
  apple: "苹果",
  sandwich: "三明治",
  orange: "橙子",
  broccoli: "西兰花",
  carrot: "胡萝卜",
  "hot dog": "热狗",
  pizza: "披萨",
  donut: "甜甜圈",
  cake: "蛋糕",
  chair: "椅子",
  couch: "沙发",
  "potted plant": "盆栽",
  bed: "床",
  "dining table": "餐桌",
  toilet: "马桶",
  tv: "电视",
  laptop: "笔记本电脑",
  mouse: "鼠标",
  remote: "遥控器",
  keyboard: "键盘",
  "cell phone": "手机",
  microwave: "微波炉",
  oven: "烤箱",
  toaster: "烤面包机",
  sink: "水槽",
  refrigerator: "冰箱",
  book: "书",
  clock: "时钟",
  vase: "花瓶",
  scissors: "剪刀",
  "teddy bear": "玩偶",
  "hair drier": "吹风机",
  toothbrush: "牙刷",
};

export function objectClassLabel(className: string) {
  return CLASS_LABELS[className] ?? className;
}

export function drawRecognizedObjects(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  objects: RecognizedObject[],
) {
  if (video.videoWidth === 0 || video.videoHeight === 0) return;
  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = "top";
  context.font = `600 ${Math.max(14, Math.round(canvas.width / 80))}px system-ui, sans-serif`;

  objects.forEach((object) => {
    const [x, y, width, height] = object.bbox;
    const hue = Array.from(object.className).reduce((value, character) => value + character.charCodeAt(0), 0) % 90 + 155;
    const color = `hsl(${hue} 78% 58%)`;
    const label = `${object.label} ${Math.round(object.score * 100)}%`;
    const labelWidth = context.measureText(label).width + 16;
    const labelHeight = Math.max(25, Math.round(canvas.height / 28));
    const labelY = Math.max(0, y - labelHeight);

    context.strokeStyle = color;
    context.lineWidth = Math.max(2, canvas.width / 500);
    context.strokeRect(x, y, width, height);
    context.fillStyle = color;
    context.fillRect(x, labelY, labelWidth, labelHeight);
    context.fillStyle = "#04161d";
    context.fillText(label, x + 8, labelY + Math.max(4, labelHeight * 0.17));
  });
}

export function recognizedObjectsToFishMapping(
  objects: RecognizedObject[],
  videoWidth: number,
  videoHeight: number,
): ObjectToFishMapping {
  if (videoWidth <= 0 || videoHeight <= 0 || objects.length === 0) {
    return { density: 0, observations: [] };
  }

  const frameArea = videoWidth * videoHeight;
  const observations = objects.map((object) => {
    const [x, y, width, height] = object.bbox;
    const areaRatio = width * height / frameArea;
    return {
      x: ((x + width / 2) / videoWidth - 0.5) * 2,
      y: (0.5 - (y + height / 2) / videoHeight) * 2,
      size: Math.min(1.5, Math.max(0.28, Math.sqrt(areaRatio) * 4.2)),
      confidence: object.score,
    };
  });
  const coverage = objects.reduce((total, object) => total + object.bbox[2] * object.bbox[3], 0) / frameArea;

  return {
    density: Math.min(100, Math.max(0, coverage * 190 + objects.length * 7)),
    observations,
  };
}

async function loadCocoSsdDetector(): Promise<BrowserObjectDetector> {
  const tf = await import("@tensorflow/tfjs");
  await tf.ready();

  if (tf.findBackend("webgl")) {
    try {
      await tf.setBackend("webgl");
      await tf.ready();
    } catch {
      await tf.setBackend("cpu");
      await tf.ready();
    }
  }

  const cocoSsd = await import("@tensorflow-models/coco-ssd");
  const configuredModelUrl = process.env.NEXT_PUBLIC_COCO_SSD_MODEL_URL?.trim();
  const model: ObjectDetection = await cocoSsd.load({
    base: "mobilenet_v2",
    ...(configuredModelUrl ? { modelUrl: configuredModelUrl } : {}),
  });

  return {
    backend: tf.getBackend(),
    modelName: "COCO-SSD MobileNet V2",
    async detect(video, minimumScore, maximumBoxes = 20) {
      const startedAt = performance.now();
      const predictions = await model.detect(video, maximumBoxes, minimumScore);
      return {
        objects: predictions.map((prediction) => ({
          bbox: prediction.bbox,
          className: prediction.class,
          label: objectClassLabel(prediction.class),
          score: prediction.score,
        })),
        inferenceMs: performance.now() - startedAt,
      };
    },
    dispose() {
      model.dispose();
    },
  };
}

export async function loadBrowserObjectDetector(
  options: DetectorLoadOptions = {},
): Promise<BrowserObjectDetector> {
  if (options.engine !== "coco-ssd") {
    try {
      const { loadYolo26Detector } = await import("@/lib/yolo26-detector");
      const yoloDetector = await loadYolo26Detector();
      return {
        ...yoloDetector,
        async detect(video, minimumScore, maximumBoxes = 20) {
          const result = await yoloDetector.detect(video, minimumScore, maximumBoxes);
          return {
            ...result,
            objects: result.objects.map((object) => ({
              ...object,
              label: objectClassLabel(object.className),
            })),
          };
        },
      };
    } catch (yoloError) {
      const fallbackDetector = await loadCocoSsdDetector();
      return {
        ...fallbackDetector,
        modelName: `${fallbackDetector.modelName}（YOLO 回退）`,
        fallbackReason: yoloError instanceof Error ? yoloError.message : "YOLO26 模型加载失败。",
      };
    }
  }

  return loadCocoSsdDetector();
}
