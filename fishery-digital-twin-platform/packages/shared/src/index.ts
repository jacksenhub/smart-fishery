export type WaterStatus = "normal" | "attention" | "polluted" | "algae-risk";
export type DeviceStatus = "online" | "warning" | "offline";
export type MissionStatus = "巡检中" | "返航中" | "待命" | "航线规划中";
export type DataSource = "sensor" | "demo" | "fallback";
export type PlatformDataMode = "live" | "mixed" | "demo" | "fallback";

export interface WaterData {
  timestamp: string;
  source: DataSource;
  waterTemperature: number;
  turbidity: number;
  ph: number;
  dissolvedOxygen: number;
  ammoniaNitrogen: number;
  conductivity: number;
  status: WaterStatus;
}

export interface BatteryData {
  id: "A" | "B" | "C";
  percentage: number;
  voltage: number;
  status: DeviceStatus;
  source: DataSource;
  lastUpdatedAt: string;
}

export interface NavigationPoint {
  lat: number;
  lng: number;
  label?: string;
  timestamp?: string;
}

export interface GpsStatus {
  device_id: string;
  coordinate_system: "WGS84";
  serial_online: boolean;
  valid: boolean;
  lat: number | null;
  lng: number | null;
  satellites: number | null;
  hdop: number | null;
  altitude_m: number | null;
  speed_mps: number | null;
  heading_deg: number | null;
  chars_processed: number;
  last_seen: string | null;
  last_fix_at: string | null;
  online: boolean;
}

export interface NavigationData {
  position: NavigationPoint;
  route: NavigationPoint[];
  targetWaypoint: NavigationPoint;
  speed: number;
  heading: number;
  remainingDistance: number;
  etaMinutes: number;
  source?: "mock" | "gps";
  gps?: GpsStatus;
}

export interface AIReport {
  id: string;
  generatedAt: string;
  status: WaterStatus;
  riskLevel: "normal" | "attention" | "warning";
  title: string;
  summary: string;
  findings: string[];
  recommendations: string[];
  dataQuality: string;
  confidence: number;
  sampleCount: number;
  model: string;
  forecast: {
    horizonHours: number;
    algaeRisk: "low" | "medium" | "high";
    turbidityTrend: "stable" | "rising" | "falling";
    batteryRuntimeHours: number;
  };
}

export interface VesselStatus {
  vesselName: string;
  online: boolean;
  mission: MissionStatus;
  aiReady: boolean;
  pixhawk: DeviceStatus;
  esp32: DeviceStatus;
  communication: DeviceStatus;
  sensor: DeviceStatus;
  fishHoldPercentage: number;
}

export interface PlatformSnapshot {
  generatedAt: string;
  dataMode: PlatformDataMode;
  water: WaterData[];
  batteries: BatteryData[];
  navigation: NavigationData;
  aiReport: AIReport;
  vessel: VesselStatus;
}

export interface ServoDevice {
  device_id: string;
  device_name: string;
  target_angles: number[];
  actual_angles: Array<number | null>;
  last_seen: string | null;
  updated_at: string | null;
  online: boolean;
}

export interface ServoSnapshot {
  devices: ServoDevice[];
  device_count: number;
  online_count: number;
  online: boolean;
}

export interface ServoCommand {
  id: string;
  type: "servo4";
  device_id: string;
  angles: number[];
  created_at: string;
}

export type PropulsionMode = "MANUAL" | "WEB" | "AUTO";

export interface PropulsionControl {
  throttle: number;
  steering: number;
  /** Direct M0/M1 channel targets. For dual actuators these are independent. */
  left_power: number;
  right_power: number;
  max_power: number;
  updated_at: string | null;
}

export interface PropulsionDevice {
  device_id: string;
  device_name: string;
  mode: PropulsionMode;
  enabled: boolean;
  emergency_stop: boolean;
  rc_online: boolean;
  web_online: boolean;
  auto_online: boolean;
  target: PropulsionControl;
  actual_left_power: number;
  actual_right_power: number;
  runtime_lockout?: boolean;
  cooldown_remaining_ms?: number;
  run_active?: boolean;
  run_remaining_ms?: number;
  cycle_phase?: "idle" | "first_leg" | "awaiting_return" | "returning" | "cooling";
  cycle_run_ms?: number;
  duty_run_ms?: number;
  duty_remaining_ms?: number;
  round_trip_count?: number;
  round_trip_limit?: number;
  last_seen: string | null;
  updated_at: string | null;
  online: boolean;
}

export interface PropulsionSnapshot {
  devices: PropulsionDevice[];
  device_count: number;
  online_count: number;
  online: boolean;
}

export interface PropulsionCommand {
  id: string;
  type: "propulsion2";
  device_id: string;
  mode: PropulsionMode;
  enabled: boolean;
  emergency_stop: boolean;
  throttle: number;
  steering: number;
  /** M0 output power percentage. */
  left_power: number;
  /** M1 output power percentage. */
  right_power: number;
  max_power: number;
  created_at: string;
}

export interface SystemLog {
  id: string;
  level: "info" | "success" | "warning" | "error";
  title: string;
  detail: string;
  source: string;
  timestamp: string;
}

export type TwinWaveLevel = "calm" | "moderate" | "rough";
export type TwinFaultType = "servo-stuck" | "motor-derate" | "feedback-loss";
export type TwinRiskLevel = "low" | "medium" | "high";

export interface TwinSimulationInput {
  routeDistanceKm: number;
  targetSpeedMps: number;
  waveLevel: TwinWaveLevel;
  faultType: TwinFaultType;
  faultSeverity: number;
  operatingHours: number;
  dailyServoCycles: number;
}

export interface TwinSimulationSource {
  label: string;
  kind: "measured" | "snapshot" | "assumed";
  detail: string;
}

export interface TwinRoutePoint {
  minute: number;
  distanceKm: number;
  speedMps: number;
  batteryPercent: number;
}

export interface TwinRoutePrediction {
  distanceKm: number;
  etaMinutes: number;
  energyUsedPercent: number;
  arrivalBatteryPercent: number;
  maxCrossTrackErrorM: number;
  completionProbability: number;
  risk: TwinRiskLevel;
  series: TwinRoutePoint[];
}

export interface TwinFaultPrediction {
  type: TwinFaultType;
  title: string;
  severity: number;
  risk: TwinRiskLevel;
  speedLossPercent: number;
  headingDriftDeg: number;
  completionProbability: number;
  detectionSeconds: number;
  recommendation: string;
  series: Array<{
    minute: number;
    normalSpeedMps: number;
    faultSpeedMps: number;
  }>;
}

export interface TwinFatigueComponent {
  id: "propulsion" | "servo" | "hull" | "battery";
  label: string;
  damagePercent: number;
  remainingLifeHours: number;
  risk: TwinRiskLevel;
  driver: string;
}

export interface TwinFatiguePrediction {
  overallHealth: number;
  nextInspectionHours: number;
  highestRiskComponent: string;
  components: TwinFatigueComponent[];
}

export interface TwinSimulationResult {
  id: string;
  generatedAt: string;
  modelVersion: string;
  confidence: number;
  input: TwinSimulationInput;
  route: TwinRoutePrediction;
  fault: TwinFaultPrediction;
  fatigue: TwinFatiguePrediction;
  sources: TwinSimulationSource[];
  assumptions: string[];
}
