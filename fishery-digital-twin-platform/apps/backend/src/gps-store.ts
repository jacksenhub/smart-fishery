import type { GpsStatus } from "@fishery/shared";

const DEFAULT_GPS_DEVICE_ID = "gps-01";
const GPS_ONLINE_TIMEOUT_MS = 10_000;

type GpsState = Omit<GpsStatus, "online">;

const gpsState: GpsState = {
  device_id: DEFAULT_GPS_DEVICE_ID,
  coordinate_system: "WGS84",
  serial_online: false,
  valid: false,
  lat: null,
  lng: null,
  satellites: null,
  hdop: null,
  altitude_m: null,
  speed_mps: null,
  heading_deg: null,
  chars_processed: 0,
  last_seen: null,
  last_fix_at: null,
};

function nowIso() {
  return new Date().toISOString();
}

function readNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readInteger(value: unknown) {
  const number = readNumber(value);
  return number === null ? null : Math.max(0, Math.round(number));
}

function isFresh(timestamp: string | null) {
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) && Date.now() - time <= GPS_ONLINE_TIMEOUT_MS;
}

function snapshot(): GpsStatus {
  const online = gpsState.serial_online && isFresh(gpsState.last_seen);
  return {
    ...gpsState,
    valid: gpsState.valid && online,
    online,
  };
}

export function getGpsStatus() {
  return snapshot();
}

export function updateGpsStatus(payload: Record<string, unknown>) {
  const coordinateSystem = String(payload.coordinate_system || "WGS84").toUpperCase();
  if (coordinateSystem !== "WGS84") {
    throw new Error("coordinate_system must be WGS84");
  }

  const previous = snapshot();
  const latitude = readNumber(payload.lat);
  const longitude = readNumber(payload.lng);
  const requestedValid = payload.valid === true;
  const coordinatesValid = latitude !== null &&
    longitude !== null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
  const valid = requestedValid && coordinatesValid;
  const receivedAt = nowIso();

  gpsState.device_id = String(payload.device_id || DEFAULT_GPS_DEVICE_ID);
  gpsState.coordinate_system = "WGS84";
  gpsState.serial_online = payload.serial_online !== false;
  gpsState.valid = valid;
  gpsState.satellites = readInteger(payload.satellites);
  gpsState.hdop = readNumber(payload.hdop);
  gpsState.altitude_m = readNumber(payload.altitude_m);
  gpsState.speed_mps = readNumber(payload.speed_mps);
  gpsState.heading_deg = readNumber(payload.heading_deg);
  gpsState.chars_processed = readInteger(payload.chars_processed) ?? gpsState.chars_processed;
  gpsState.last_seen = receivedAt;

  if (valid) {
    gpsState.lat = latitude;
    gpsState.lng = longitude;
    gpsState.last_fix_at = receivedAt;
  }

  const current = snapshot();
  return {
    gps: current,
    becameOnline: !previous.online && current.online,
    fixAcquired: !previous.valid && current.valid,
  };
}
