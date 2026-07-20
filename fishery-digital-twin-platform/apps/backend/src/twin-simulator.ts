import { randomUUID } from "node:crypto";
import type {
  PlatformSnapshot,
  PropulsionSnapshot,
  ServoSnapshot,
  TwinFatigueComponent,
  TwinRiskLevel,
  TwinSimulationInput,
  TwinSimulationResult,
} from "@fishery/shared";

const MODEL_VERSION = "UISYS-TWIN-PREDICT-1.0";

const waveProfile = {
  calm: { speed: 0.97, load: 0.86, crossTrack: 1.6 },
  moderate: { speed: 0.84, load: 1.08, crossTrack: 4.8 },
  rough: { speed: 0.64, load: 1.42, crossTrack: 10.5 },
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function riskFromScore(score: number): TwinRiskLevel {
  if (score >= 70) return "high";
  if (score >= 38) return "medium";
  return "low";
}

function sanitizeInput(input: Partial<TwinSimulationInput>): TwinSimulationInput {
  const waveLevel = input.waveLevel === "calm" || input.waveLevel === "rough" ? input.waveLevel : "moderate";
  const faultType = input.faultType === "servo-stuck" || input.faultType === "feedback-loss"
    ? input.faultType
    : "motor-derate";

  return {
    routeDistanceKm: round(clamp(Number(input.routeDistanceKm) || 1.6, 0.2, 20), 1),
    targetSpeedMps: round(clamp(Number(input.targetSpeedMps) || 1.2, 0.2, 3), 1),
    waveLevel,
    faultType,
    faultSeverity: Math.round(clamp(Number(input.faultSeverity) || 45, 10, 100)),
    operatingHours: Math.round(clamp(Number(input.operatingHours) || 800, 0, 30_000)),
    dailyServoCycles: Math.round(clamp(Number(input.dailyServoCycles) || 480, 10, 10_000)),
  };
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function createFatigueComponent(
  id: TwinFatigueComponent["id"],
  label: string,
  damagePercent: number,
  remainingLifeHours: number,
  driver: string,
): TwinFatigueComponent {
  const damage = clamp(damagePercent, 0, 100);
  return {
    id,
    label,
    damagePercent: round(damage, 1),
    remainingLifeHours: Math.max(0, Math.round(remainingLifeHours)),
    risk: riskFromScore(damage),
    driver,
  };
}

export function runTwinSimulation(
  rawInput: Partial<TwinSimulationInput>,
  snapshot: PlatformSnapshot,
  servos: ServoSnapshot,
  propulsion: PropulsionSnapshot,
): TwinSimulationResult {
  const input = sanitizeInput(rawInput);
  const wave = waveProfile[input.waveLevel];
  const averageBattery = average(snapshot.batteries.map((battery) => battery.percentage));
  const onlinePropulsion = propulsion.devices.filter((device) => device.online);
  const onlineServos = servos.devices.filter((device) => device.online);
  const actualMotorPower = average(onlinePropulsion.flatMap((device) => [Math.abs(device.actual_left_power), Math.abs(device.actual_right_power)]));
  const motorAsymmetry = average(onlinePropulsion.map((device) => Math.abs(device.actual_left_power - device.actual_right_power)));
  const servoErrors = onlineServos.flatMap((device) => device.actual_angles.flatMap((actual, index) => (
    actual === null ? [] : [Math.abs(actual - device.target_angles[index])]
  )));
  const servoTrackingError = average(servoErrors);
  const feedbackFactor = clamp(1 - motorAsymmetry * 0.002 - servoTrackingError * 0.0015, 0.78, 1);
  const effectiveSpeed = clamp(input.targetSpeedMps * wave.speed * feedbackFactor, 0.12, 3);
  const etaMinutes = input.routeDistanceKm * 1000 / effectiveSpeed / 60;
  const tripHours = etaMinutes / 60;
  const speedLoad = clamp(input.targetSpeedMps / 1.8, 0.2, 1.7);
  const telemetryLoad = onlinePropulsion.length > 0 ? clamp(actualMotorPower / 35, 0.2, 1.5) : speedLoad;
  const drainPerHour = 6.2 + 6.8 * speedLoad ** 2 * wave.load + telemetryLoad * 2.4;
  const energyUsed = clamp(tripHours * drainPerHour, 0.3, 100);
  const arrivalBattery = clamp(averageBattery - energyUsed, 0, 100);
  const crossTrackError = wave.crossTrack + servoTrackingError * 0.08 + motorAsymmetry * 0.04;
  const completionProbability = clamp(
    99 - Math.max(0, 24 - arrivalBattery) * 1.5 - crossTrackError * 0.55 - (input.waveLevel === "rough" ? 8 : 0),
    8,
    99,
  );
  const routeRisk = completionProbability < 70 || arrivalBattery < 15 ? "high" : completionProbability < 88 ? "medium" : "low";
  const routeSeries = Array.from({ length: 17 }, (_value, index) => {
    const progress = index / 16;
    const seaPulse = Math.sin(progress * Math.PI * 4) * (input.waveLevel === "rough" ? 0.12 : input.waveLevel === "moderate" ? 0.06 : 0.025);
    return {
      minute: round(etaMinutes * progress, 1),
      distanceKm: round(input.routeDistanceKm * progress, 2),
      speedMps: round(Math.max(0.1, effectiveSpeed + seaPulse), 2),
      batteryPercent: round(averageBattery - energyUsed * progress, 1),
    };
  });

  const faultConfig = {
    "servo-stuck": {
      title: "单舵机卡滞",
      speedLoss: input.faultSeverity * 0.16,
      headingDrift: 1.5 + input.faultSeverity * 0.19,
      detectionSeconds: 3,
      recommendation: "切换剩余舵机降级控制，限制航速并规划最近安全返航点。",
    },
    "motor-derate": {
      title: "推进电机降额",
      speedLoss: input.faultSeverity * 0.68,
      headingDrift: 0.8 + input.faultSeverity * 0.07,
      detectionSeconds: 2,
      recommendation: "限制另一侧输出以保持航向，重新计算返航能耗并检查电机电流与温升。",
    },
    "feedback-loss": {
      title: "执行机构反馈丢失",
      speedLoss: 4 + input.faultSeverity * 0.12,
      headingDrift: 2 + input.faultSeverity * 0.1,
      detectionSeconds: 8,
      recommendation: "冻结最后可信目标值，进入低速保护并等待连续反馈恢复。",
    },
  }[input.faultType];
  const faultSpeedLoss = clamp(faultConfig.speedLoss, 0, 82);
  const faultHeadingDrift = clamp(faultConfig.headingDrift, 0, 30);
  const faultCompletion = clamp(completionProbability - faultSpeedLoss * 0.48 - faultHeadingDrift * 0.42, 3, 98);
  const faultRisk: TwinRiskLevel = faultCompletion < 58 || faultHeadingDrift > 18 ? "high" : faultCompletion < 82 ? "medium" : "low";
  const faultSeries = Array.from({ length: 13 }, (_value, index) => {
    const progress = index / 12;
    const faultRamp = index < 2 ? 0 : Math.min(1, (index - 1) / 3);
    return {
      minute: round(etaMinutes * progress, 1),
      normalSpeedMps: round(effectiveSpeed, 2),
      faultSpeedMps: round(effectiveSpeed * (1 - faultSpeedLoss / 100 * faultRamp), 2),
    };
  });

  const waveLoad = input.waveLevel === "rough" ? 1.55 : input.waveLevel === "moderate" ? 1.12 : 0.86;
  const motorLoad = onlinePropulsion.length > 0 ? clamp(actualMotorPower / 35, 0.18, 1.6) : speedLoad;
  const propulsionEquivalentHours = input.operatingHours * (0.42 + motorLoad * 0.56) * waveLoad;
  const propulsionDamage = propulsionEquivalentHours / 5200 * 100;
  const usedServoCycles = input.dailyServoCycles * (input.operatingHours / 8);
  const servoCycleLimit = 1_200_000 / (1 + servoTrackingError / 35);
  const servoDamage = usedServoCycles / servoCycleLimit * 100;
  const hullEquivalentHours = input.operatingHours * waveLoad * (0.86 + speedLoad * 0.15);
  const hullDamage = hullEquivalentHours / 12_000 * 100;
  const batteryEquivalentCycles = input.operatingHours / 5.2 * (0.78 + speedLoad * 0.24);
  const batteryDamage = batteryEquivalentCycles / 650 * 100;
  const components = [
    createFatigueComponent("propulsion", "推进电机与轴系", propulsionDamage, (5200 - propulsionEquivalentHours) / Math.max(0.2, (0.42 + motorLoad * 0.56) * waveLoad), `实测负载 ${Math.round(actualMotorPower)}%，海况修正 ×${waveLoad.toFixed(2)}`),
    createFatigueComponent("servo", "舵机与连杆", servoDamage, Math.max(0, servoCycleLimit - usedServoCycles) / input.dailyServoCycles * 8, `日动作 ${input.dailyServoCycles} 次，跟踪误差 ${servoTrackingError.toFixed(1)}°`),
    createFatigueComponent("hull", "船体连接结构", hullDamage, (12_000 - hullEquivalentHours) / Math.max(0.2, waveLoad), `累计 ${input.operatingHours} h，海况载荷 ×${waveLoad.toFixed(2)}`),
    createFatigueComponent("battery", "动力电池", batteryDamage, Math.max(0, 650 - batteryEquivalentCycles) * 5.2, `折算循环 ${Math.round(batteryEquivalentCycles)} 次，当前均值 ${Math.round(averageBattery)}%`),
  ];
  const highestRisk = [...components].sort((a, b) => b.damagePercent - a.damagePercent)[0];
  const averageDamage = average(components.map((component) => component.damagePercent));
  const overallHealth = clamp(100 - highestRisk.damagePercent * 0.72 - averageDamage * 0.28, 0, 100);
  const nextInspectionHours = highestRisk.risk === "high"
    ? 24
    : highestRisk.risk === "medium"
      ? 80
      : Math.min(250, Math.max(40, Math.round(highestRisk.remainingLifeHours * 0.12)));

  const confidence = clamp(
    46
      + (onlinePropulsion.length > 0 ? 14 : 0)
      + Math.min(14, onlineServos.length * 7)
      + (snapshot.navigation.speed > 0 ? 7 : 0)
      + (snapshot.water.length > 0 ? 5 : 0),
    35,
    92,
  );

  return {
    id: randomUUID(),
    generatedAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    confidence: Math.round(confidence),
    input,
    route: {
      distanceKm: input.routeDistanceKm,
      etaMinutes: round(etaMinutes, 1),
      energyUsedPercent: round(energyUsed, 1),
      arrivalBatteryPercent: round(arrivalBattery, 1),
      maxCrossTrackErrorM: round(crossTrackError, 1),
      completionProbability: Math.round(completionProbability),
      risk: routeRisk,
      series: routeSeries,
    },
    fault: {
      type: input.faultType,
      title: faultConfig.title,
      severity: input.faultSeverity,
      risk: faultRisk,
      speedLossPercent: round(faultSpeedLoss, 1),
      headingDriftDeg: round(faultHeadingDrift, 1),
      completionProbability: Math.round(faultCompletion),
      detectionSeconds: faultConfig.detectionSeconds,
      recommendation: faultConfig.recommendation,
      series: faultSeries,
    },
    fatigue: {
      overallHealth: Math.round(overallHealth),
      nextInspectionHours,
      highestRiskComponent: highestRisk.label,
      components,
    },
    sources: [
      {
        label: "执行机构反馈",
        kind: onlineServos.length > 0 ? "measured" : "assumed",
        detail: onlineServos.length > 0 ? `${onlineServos.length} 块舵机板、${servoErrors.length} 路实测角度` : "无在线舵机反馈，使用额定跟踪误差",
      },
      {
        label: "推进反馈",
        kind: onlinePropulsion.length > 0 ? "measured" : "assumed",
        detail: onlinePropulsion.length > 0 ? `${onlinePropulsion.length} 块推进板，平均实测输出 ${Math.round(actualMotorPower)}%` : "无在线推进反馈，按目标航速估算负载",
      },
      {
        label: "航行与电池",
        kind: "snapshot",
        detail: `平台航速 ${snapshot.navigation.speed.toFixed(2)} m/s，电池均值 ${Math.round(averageBattery)}%`,
      },
      {
        label: "结构寿命参数",
        kind: "assumed",
        detail: "采用工程额定寿命与海况载荷系数，尚未接入应变和振动传感器",
      },
    ],
    assumptions: [
      "航线预演采用准静态阻力与能耗模型，未包含实时风速、流速和浪高传感器。",
      "故障推演不会向 ESP32 下发任何控制命令，只在服务器内计算降级结果。",
      "疲劳结果是工程估算；接入电流、振动、应变与历史动作计数后才能形成可校准的剩余寿命模型。",
    ],
  };
}
