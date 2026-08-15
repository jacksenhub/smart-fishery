import assert from "node:assert/strict";
import test from "node:test";
import { getGpsStatus, updateGpsStatus } from "./gps-store.js";
import {
  getPropulsionSnapshot,
  setPropulsionTarget,
  takePropulsionCommands,
  updatePropulsionStatus,
} from "./propulsion-store.js";
import { setServoTargets, takeServoCommands, updateServoStatus } from "./servo-store.js";

test("GPS rejects non-WGS84 payloads and accepts a bounded WGS84 fix", () => {
  assert.throws(() => updateGpsStatus({ coordinate_system: "GCJ02" }), /WGS84/);
  const result = updateGpsStatus({
    device_id: "gps-test",
    coordinate_system: "WGS84",
    serial_online: true,
    valid: true,
    lat: 22.368,
    lng: 113.538,
    satellites: 9,
  });
  assert.equal(result.gps.valid, true);
  assert.equal(getGpsStatus().online, true);
});

test("servo commands require an online device and remain available during their delivery window", () => {
  assert.throws(
    () => setServoTargets({ device_id: "servo-test-offline", angles: [90, 90, 90, 90] }),
    /offline/,
  );
  updateServoStatus({ device_id: "servo-test", angles: [90, 90, 90, 90] });
  const result = setServoTargets({ device_id: "servo-test", channel: 1, angle: 120 });
  assert.equal(result.command.angles[0], 120);
  assert.equal(takeServoCommands("servo-test")[0]?.id, result.command.id);
  assert.equal(takeServoCommands("servo-test")[0]?.id, result.command.id);
});

test("board 1 servo limits and reserved GPS channel are enforced by the backend", () => {
  updateServoStatus({ device_id: "servo-quad-01", angles: [90, 90, 90, 90] });
  const result = setServoTargets({
    device_id: "servo-quad-01",
    angles: [180, 180, 180, 180],
  });
  assert.deepEqual(result.command.angles, [160, 160, 180, 90]);
  assert.throws(
    () => setServoTargets({ device_id: "servo-quad-01", channel: 4, angle: 120 }),
    /reserved/,
  );
});

test("propulsion never reports a requested target as measured feedback", () => {
  assert.throws(
    () => setPropulsionTarget({ device_id: "propulsion-offline", mode: "WEB", enabled: true, throttle: 30 }),
    /offline/,
  );
  updatePropulsionStatus({
    device_id: "propulsion-test",
    mode: "MANUAL",
    actual_left_power: 7,
    actual_right_power: 4,
  });
  const result = setPropulsionTarget({
    device_id: "propulsion-test",
    mode: "WEB",
    enabled: true,
    emergency_stop: false,
    throttle: 30,
    steering: 0,
    max_power: 50,
  });
  assert.equal(result.device.actual_left_power, 7);
  assert.equal(result.device.actual_right_power, 4);
  assert.equal(takePropulsionCommands("propulsion-test")[0]?.id, result.command.id);
  const snapshot = getPropulsionSnapshot("propulsion-test");
  assert.equal("actual_left_power" in snapshot && snapshot.actual_left_power, 7);
});

test("an emergency-stop command can be queued even while propulsion feedback is offline", () => {
  const result = setPropulsionTarget({
    device_id: "propulsion-stop-test",
    mode: "WEB",
    enabled: false,
    emergency_stop: true,
    throttle: 100,
    steering: 100,
    max_power: 100,
  });
  assert.equal(result.command.emergency_stop, true);
  assert.equal(result.command.left_power, 0);
  assert.equal(result.command.right_power, 0);
});
