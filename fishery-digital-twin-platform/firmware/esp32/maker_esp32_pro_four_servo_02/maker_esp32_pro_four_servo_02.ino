/*
  MAKER-ESP32-PRO four-servo + SXTL linear actuator controller - board 02.

  Data path:
  Web page -> Express backend -> ESP32 polls commands -> four servos move.
  Web page -> Express backend -> ESP32 polls motor commands.
  M0 drives the 12V 24W SXTL actuator.

  Arduino IDE library:
  - ESP32Servo

  MAKER-ESP32-PRO onboard servo ports:
  Servo 1 -> GPIO25
  Servo 2 -> GPIO26
  Servo 3 -> GPIO32
  Servo 4 -> GPIO33

  12V SXTL linear actuator:
  - SXTL power wires -> M0 motor output (GPIO27 / GPIO13).
  - Rated 12V / 24W; built-in end-limit switches are still required.
  - Each direction leg is limited to 120 seconds.
  - A normal first-leg stop allows the reverse leg immediately.
  - Completed round trips accumulate powered time without forcing an immediate cooldown.
  - Four completed round trips or 120 seconds total powered time, whichever comes first,
    stops output and starts a fixed 18-minute cooldown.

  This sketch is for the second MAKER-ESP32-PRO servo board.
  Device ID must be unique:
  - First board:  servo-quad-01
  - Second board: servo-quad-02
*/

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <ESP32Servo.h>

#if __has_include("wifi_secrets.h")
#include "wifi_secrets.h"
#else
#error "Create wifi_secrets.h from wifi_secrets.example.h before compiling."
#endif
const uint16_t BACKEND_DISCOVERY_PORT = 42110;
const uint16_t BACKEND_DISCOVERY_LOCAL_PORT = 42112;
const char* BACKEND_DISCOVERY_REQUEST = "UISYS_DISCOVER_V1";
const char* BACKEND_DISCOVERY_RESPONSE_PREFIX = "UISYS_BACKEND_V1|";
const unsigned long BACKEND_DISCOVERY_RETRY_INTERVAL_MS = 5000;

const char* DEVICE_ID = "servo-quad-02";
const char* DEVICE_NAME = "maker-esp32-pro-servo-02";
const char* LINEAR_MOTOR_DEVICE_ID = "maker-esp32-pro-linear-01-m1";
const char* LINEAR_MOTOR_DEVICE_NAME = "maker-esp32-pro-sxtl-m0";
const char* FIRMWARE_VERSION = "2026-08-02-board2-sxtl-four-cycle-limit";

const int SERVO_COUNT = 4;
const int SERVO_PINS[SERVO_COUNT] = {25, 26, 32, 33};
const int SERVO_MIN_US = 500;
const int SERVO_MAX_US = 2400;
const int START_ANGLE = 90;

const int LINEAR_MOTOR_COUNT = 1;
const int LINEAR_MOTOR_IN_A[LINEAR_MOTOR_COUNT] = {27};
const int LINEAR_MOTOR_IN_B[LINEAR_MOTOR_COUNT] = {13};
const uint32_t LINEAR_MOTOR_PWM_FREQUENCY_HZ = 1000;
const int LINEAR_MOTOR_POWER_LIMIT_PERCENT = 100;
const int LINEAR_MOTOR_DEADBAND_PERCENT = 4;
const int LINEAR_MOTOR_RAMP_STEP_PERCENT = 1;

const unsigned long COMMAND_INTERVAL_MS = 400;
const unsigned long STATUS_INTERVAL_MS = 2000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 5000;
const unsigned long HTTP_TIMEOUT_MS = 1000;
const unsigned long LINEAR_MOTOR_COMMAND_INTERVAL_MS = 300;
const unsigned long LINEAR_MOTOR_STATUS_INTERVAL_MS = 1500;
const unsigned long LINEAR_MOTOR_COMMAND_TIMEOUT_MS = 2200;
const unsigned long LINEAR_MOTOR_RAMP_INTERVAL_MS = 20;
const unsigned long LINEAR_MOTOR_MAX_RUN_MS = 120000UL;
const unsigned long LINEAR_MOTOR_DUTY_RUN_LIMIT_MS = 120000UL;
const unsigned long LINEAR_MOTOR_COOLDOWN_DURATION_MS = 18UL * 60UL * 1000UL;
const unsigned int LINEAR_MOTOR_ROUND_TRIP_LIMIT = 4;

Servo servos[SERVO_COUNT];
WiFiUDP backendDiscoveryUdp;
IPAddress backendServerIp;
uint16_t backendServerPort = 5000;
String backendServerBase;
bool backendDiscovered = false;
bool backendDiscoveryUdpStarted = false;
bool wifiPreviouslyConnected = false;
int currentAngles[SERVO_COUNT] = {
  START_ANGLE, START_ANGLE, START_ANGLE, START_ANGLE
};

int linearMotorTargetPower[LINEAR_MOTOR_COUNT] = {0};
int linearMotorCurrentPower[LINEAR_MOTOR_COUNT] = {0};
bool linearMotorCommandEnabled = false;
bool linearMotorEmergencyStop = false;
bool linearMotorWebMode = false;
bool linearMotorRunActive = false;
bool linearMotorRuntimeLockout = false;
bool linearMotorCooldownActive = false;
bool linearMotorCycleActive = false;
bool linearMotorReturnLegStarted = false;
int linearMotorFirstDirection = 0;
int linearMotorActiveDirection = 0;

unsigned long lastCommandMs = 0;
unsigned long lastStatusMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastLinearMotorCommandPollMs = 0;
unsigned long lastLinearMotorCommandReceivedMs = 0;
unsigned long lastLinearMotorStatusMs = 0;
unsigned long lastLinearMotorRampMs = 0;
unsigned long linearMotorRunStartedMs = 0;
unsigned long linearMotorCooldownStartedMs = 0;
unsigned long linearMotorCooldownDurationMs = 0;
unsigned long linearMotorCycleRunDurationMs = 0;
unsigned long linearMotorLegRunDurationMs = 0;
unsigned long linearMotorDutyRunDurationMs = 0;
unsigned int linearMotorCompletedRoundTrips = 0;
unsigned long lastBackendDiscoveryAttemptMs = 0;

struct LinearMotorCommand {
  bool valid;
  bool enabled;
  bool emergencyStop;
  bool webMode;
  int power[LINEAR_MOTOR_COUNT];
};

void setupServos();
void setupLinearMotor();
void connectWiFi();
bool discoverBackend(unsigned long timeoutMs);
bool ensureBackendDiscovered();
void invalidateBackend();
IPAddress subnetBroadcastAddress();
void testServerConnection();
void maintainWiFi();
void pollCommands();
void pollLinearMotorCommands();
bool readServoAngles(const String& payload, int outputAngles[]);
bool parseLinearMotorCommand(const String& payload, LinearMotorCommand& command);
bool extractBool(const String& payload, const char* key, bool fallback);
int extractInt(const String& payload, const char* key, int fallback);
void moveServosSmoothly(const int targetAngles[]);
void applyLinearMotorCommand(const LinearMotorCommand& command);
void enforceLinearMotorSafety();
void updateLinearMotorRamp();
void writeLinearMotorPower(int motorIndex, int powerPercent);
void stopLinearMotorImmediately();
void beginLinearMotorLeg(int direction);
void accumulateLinearMotorRunTime();
void finishLinearMotorRun(bool forceCooldown);
void beginLinearMotorCooldown();
void resetLinearMotorCycle();
const char* linearMotorCyclePhase();
bool isLinearMotorCoolingDown();
unsigned long linearMotorCooldownRemainingMs();
unsigned long linearMotorRunRemainingMs();
unsigned long linearMotorDutyRunElapsedMs();
unsigned long linearMotorDutyRemainingMs();
void reportStatus();
void reportLinearMotorStatus();
void printAngles(const int angles[]);

void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println("MAKER-ESP32-PRO servo + SXTL actuator controller starting...");
  Serial.print("Firmware: ");
  Serial.println(FIRMWARE_VERSION);
  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);

  setupServos();
  setupLinearMotor();
  connectWiFi();
}

void loop() {
  maintainWiFi();
  enforceLinearMotorSafety();
  updateLinearMotorRamp();

  const unsigned long now = millis();
  if (now - lastLinearMotorCommandPollMs >= LINEAR_MOTOR_COMMAND_INTERVAL_MS) {
    lastLinearMotorCommandPollMs = now;
    pollLinearMotorCommands();
  }

  if (now - lastCommandMs >= COMMAND_INTERVAL_MS) {
    lastCommandMs = now;
    pollCommands();
  }

  if (now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    reportStatus();
  }

  if (now - lastLinearMotorStatusMs >= LINEAR_MOTOR_STATUS_INTERVAL_MS) {
    lastLinearMotorStatusMs = now;
    reportLinearMotorStatus();
  }
}

void setupLinearMotor() {
  for (int motorIndex = 0; motorIndex < LINEAR_MOTOR_COUNT; motorIndex += 1) {
    pinMode(LINEAR_MOTOR_IN_A[motorIndex], OUTPUT);
    pinMode(LINEAR_MOTOR_IN_B[motorIndex], OUTPUT);
  }
  stopLinearMotorImmediately();

  for (int motorIndex = 0; motorIndex < LINEAR_MOTOR_COUNT; motorIndex += 1) {
    analogWriteFrequency(LINEAR_MOTOR_IN_A[motorIndex], LINEAR_MOTOR_PWM_FREQUENCY_HZ);
    analogWriteFrequency(LINEAR_MOTOR_IN_B[motorIndex], LINEAR_MOTOR_PWM_FREQUENCY_HZ);
    Serial.print("SXTL actuator M");
    Serial.print(motorIndex);
    Serial.print(" driver pins: GPIO");
    Serial.print(LINEAR_MOTOR_IN_A[motorIndex]);
    Serial.print("/GPIO");
    Serial.println(LINEAR_MOTOR_IN_B[motorIndex]);
  }
  Serial.print("SXTL power limit: ");
  Serial.print(LINEAR_MOTOR_POWER_LIMIT_PERCENT);
  Serial.println("%");
  Serial.print("SXTL max run: ");
  Serial.print(LINEAR_MOTOR_MAX_RUN_MS / 1000);
  Serial.println(" seconds");
}

void setupServos() {
  for (int index = 0; index < SERVO_COUNT; index += 1) {
    servos[index].setPeriodHertz(50);
    servos[index].attach(SERVO_PINS[index], SERVO_MIN_US, SERVO_MAX_US);
    servos[index].write(currentAngles[index]);

    Serial.print("Servo ");
    Serial.print(index + 1);
    Serial.print(" attached to GPIO");
    Serial.println(SERVO_PINS[index]);
  }

  delay(800);
  Serial.println("All servos centered at 90 degrees.");
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptMs = millis();

  Serial.print("Connecting WiFi");
  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 15000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    wifiPreviouslyConnected = true;
    Serial.print("WiFi connected, ESP32 IP: ");
    Serial.println(WiFi.localIP());
    backendDiscoveryUdpStarted = backendDiscoveryUdp.begin(BACKEND_DISCOVERY_LOCAL_PORT) == 1;
    if (discoverBackend(2500)) {
      testServerConnection();
    }
  } else {
    Serial.println("WiFi connect timeout. Will retry.");
  }
}

IPAddress subnetBroadcastAddress() {
  const IPAddress localIp = WiFi.localIP();
  const IPAddress subnetMask = WiFi.subnetMask();
  return IPAddress(
    localIp[0] | static_cast<uint8_t>(~subnetMask[0]),
    localIp[1] | static_cast<uint8_t>(~subnetMask[1]),
    localIp[2] | static_cast<uint8_t>(~subnetMask[2]),
    localIp[3] | static_cast<uint8_t>(~subnetMask[3])
  );
}

void invalidateBackend() {
  backendDiscovered = false;
  backendServerBase = "";
}

bool discoverBackend(unsigned long timeoutMs) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (!backendDiscoveryUdpStarted) {
    backendDiscoveryUdpStarted = backendDiscoveryUdp.begin(BACKEND_DISCOVERY_LOCAL_PORT) == 1;
  }
  if (!backendDiscoveryUdpStarted) {
    Serial.println("Backend discovery UDP start failed.");
    return false;
  }

  lastBackendDiscoveryAttemptMs = millis();
  const IPAddress broadcastIp = subnetBroadcastAddress();
  backendDiscoveryUdp.beginPacket(broadcastIp, BACKEND_DISCOVERY_PORT);
  backendDiscoveryUdp.print(BACKEND_DISCOVERY_REQUEST);
  backendDiscoveryUdp.print("|");
  backendDiscoveryUdp.print(DEVICE_ID);
  backendDiscoveryUdp.endPacket();

  Serial.print("Discovering backend via UDP ");
  Serial.print(broadcastIp);
  Serial.print(":");
  Serial.println(BACKEND_DISCOVERY_PORT);

  const unsigned long startedAt = millis();
  while (millis() - startedAt < timeoutMs) {
    const int packetSize = backendDiscoveryUdp.parsePacket();
    if (packetSize > 0) {
      const IPAddress responseIp = backendDiscoveryUdp.remoteIP();
      char responseBuffer[64];
      const int bytesRead = backendDiscoveryUdp.read(responseBuffer, sizeof(responseBuffer) - 1);
      if (bytesRead <= 0) continue;
      responseBuffer[bytesRead] = '\0';
      const String response(responseBuffer);
      const String prefix(BACKEND_DISCOVERY_RESPONSE_PREFIX);
      if (!response.startsWith(prefix)) continue;

      const long advertisedPort = response.substring(prefix.length()).toInt();
      if (advertisedPort <= 0 || advertisedPort > 65535) continue;
      backendServerIp = responseIp;
      backendServerPort = static_cast<uint16_t>(advertisedPort);
      backendServerBase = "http://" + backendServerIp.toString() + ":" + String(backendServerPort);
      backendDiscovered = true;
      Serial.print("Backend discovered: ");
      Serial.println(backendServerBase);
      return true;
    }
    delay(20);
  }

  Serial.println("Backend discovery timed out; will retry.");
  return false;
}

bool ensureBackendDiscovered() {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (backendDiscovered) return true;
  if (millis() - lastBackendDiscoveryAttemptMs < BACKEND_DISCOVERY_RETRY_INTERVAL_MS) return false;
  return discoverBackend(1200);
}

void testServerConnection() {
  if (!backendDiscovered) return;
  WiFiClient client;
  Serial.print("TCP test ");
  Serial.print(backendServerIp);
  Serial.print(":");
  Serial.print(backendServerPort);
  Serial.print(" -> ");

  if (client.connect(backendServerIp, backendServerPort, 3000)) {
    Serial.println("connected");
    client.stop();
  } else {
    Serial.println("failed");
    invalidateBackend();
  }
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiPreviouslyConnected) {
      wifiPreviouslyConnected = true;
      invalidateBackend();
      backendDiscoveryUdpStarted = backendDiscoveryUdp.begin(BACKEND_DISCOVERY_LOCAL_PORT) == 1;
    }
    ensureBackendDiscovered();
    return;
  }

  if (wifiPreviouslyConnected) {
    wifiPreviouslyConnected = false;
    invalidateBackend();
    backendDiscoveryUdp.stop();
    backendDiscoveryUdpStarted = false;
  }

  const unsigned long now = millis();
  if (now - lastWifiAttemptMs < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  lastWifiAttemptMs = now;
  Serial.println("Reconnecting WiFi...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void pollCommands() {
  if (!ensureBackendDiscovered()) {
    return;
  }

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.begin(backendServerBase + "/api/device/commands?device_id=" + DEVICE_ID);
  http.addHeader("X-UISYS-Token", UISYS_API_TOKEN);
  const int code = http.GET();

  if (code == 200) {
    const String payload = http.getString();
    int nextAngles[SERVO_COUNT];
    if (readServoAngles(payload, nextAngles)) {
      moveServosSmoothly(nextAngles);
      reportStatus();
      lastStatusMs = millis();
    }
  } else {
    Serial.print("GET commands failed: ");
    Serial.print(code);
    if (code < 0) {
      Serial.print(" (");
      Serial.print(HTTPClient::errorToString(code).c_str());
      Serial.println(")");
    } else {
      Serial.print(" ");
      Serial.println(http.getString());
    }
  }

  if (code < 0) invalidateBackend();
  http.end();
}

void pollLinearMotorCommands() {
  if (!ensureBackendDiscovered()) {
    return;
  }

  HTTPClient http;
  http.setTimeout(700);
  http.begin(backendServerBase + "/api/propulsion/commands?device_id=" + LINEAR_MOTOR_DEVICE_ID);
  http.addHeader("X-UISYS-Token", UISYS_API_TOKEN);
  const int code = http.GET();

  if (code == 200) {
    const String payload = http.getString();
    LinearMotorCommand command;
    if (parseLinearMotorCommand(payload, command)) {
      applyLinearMotorCommand(command);
    }
  } else {
    Serial.print("GET linear actuator commands failed: ");
    Serial.print(code);
    if (code < 0) {
      Serial.print(" (");
      Serial.print(HTTPClient::errorToString(code).c_str());
      Serial.print(")");
    }
    Serial.println();
  }

  if (code < 0) invalidateBackend();
  http.end();
}

bool readServoAngles(const String& payload, int outputAngles[]) {
  const int typeIndex = payload.indexOf("\"servo4\"");
  if (typeIndex < 0) {
    return false;
  }

  const int anglesKeyIndex = payload.indexOf("\"angles\"");
  if (anglesKeyIndex < 0) {
    return false;
  }

  int cursor = payload.indexOf('[', anglesKeyIndex);
  if (cursor < 0) {
    return false;
  }
  cursor += 1;

  for (int index = 0; index < SERVO_COUNT; index += 1) {
    while (cursor < payload.length() &&
           (payload[cursor] == ' ' || payload[cursor] == '\r' || payload[cursor] == '\n')) {
      cursor += 1;
    }

    int end = cursor;
    while (end < payload.length() && isDigit(payload[end])) {
      end += 1;
    }
    if (end == cursor) {
      return false;
    }

    const int angle = payload.substring(cursor, end).toInt();
    if (angle < 0 || angle > 180) {
      return false;
    }
    outputAngles[index] = angle;

    if (index < SERVO_COUNT - 1) {
      cursor = payload.indexOf(',', end);
      if (cursor < 0) {
        return false;
      }
      cursor += 1;
    }
  }

  return true;
}

bool parseLinearMotorCommand(const String& payload, LinearMotorCommand& command) {
  command.valid = false;

  if (payload.indexOf("\"propulsion2\"") < 0) {
    return false;
  }

  command.enabled = extractBool(payload, "\"enabled\"", false);
  command.emergencyStop = extractBool(payload, "\"emergency_stop\"", true);
  command.webMode = payload.indexOf("\"mode\":\"WEB\"") >= 0;

  const int requestedMaxPower = constrain(
    extractInt(payload, "\"max_power\"", LINEAR_MOTOR_POWER_LIMIT_PERCENT),
    0,
    LINEAR_MOTOR_POWER_LIMIT_PERCENT
  );
  command.power[0] = constrain(
    extractInt(payload, "\"left_power\"", 0),
    -requestedMaxPower,
    requestedMaxPower
  );
  command.valid = true;
  return true;
}

bool extractBool(const String& payload, const char* key, bool fallback) {
  const int keyIndex = payload.indexOf(key);
  if (keyIndex < 0) {
    return fallback;
  }

  const int colonIndex = payload.indexOf(':', keyIndex);
  if (colonIndex < 0) {
    return fallback;
  }

  int cursor = colonIndex + 1;
  while (cursor < payload.length() && payload[cursor] == ' ') {
    cursor += 1;
  }

  if (payload.substring(cursor, cursor + 4) == "true") {
    return true;
  }
  if (payload.substring(cursor, cursor + 5) == "false") {
    return false;
  }
  return fallback;
}

int extractInt(const String& payload, const char* key, int fallback) {
  const int keyIndex = payload.indexOf(key);
  if (keyIndex < 0) {
    return fallback;
  }

  const int colonIndex = payload.indexOf(':', keyIndex);
  if (colonIndex < 0) {
    return fallback;
  }

  int cursor = colonIndex + 1;
  while (cursor < payload.length() && (payload[cursor] == ' ' || payload[cursor] == '"')) {
    cursor += 1;
  }

  bool negative = false;
  if (cursor < payload.length() && payload[cursor] == '-') {
    negative = true;
    cursor += 1;
  }

  int value = 0;
  bool hasDigit = false;
  while (cursor < payload.length() && isDigit(payload[cursor])) {
    hasDigit = true;
    value = value * 10 + (payload[cursor] - '0');
    cursor += 1;
  }

  if (!hasDigit) {
    return fallback;
  }
  return negative ? -value : value;
}

void moveServosSmoothly(const int targetAngles[]) {
  bool commandChanged = false;
  bool moving = true;
  while (moving) {
    moving = false;

    for (int index = 0; index < SERVO_COUNT; index += 1) {
      if (currentAngles[index] < targetAngles[index]) {
        currentAngles[index] = min(currentAngles[index] + 2, targetAngles[index]);
        moving = true;
        commandChanged = true;
        servos[index].write(currentAngles[index]);
      } else if (currentAngles[index] > targetAngles[index]) {
        currentAngles[index] = max(currentAngles[index] - 2, targetAngles[index]);
        moving = true;
        commandChanged = true;
        servos[index].write(currentAngles[index]);
      }
    }

    if (moving) {
      enforceLinearMotorSafety();
      updateLinearMotorRamp();
      delay(20);
    }
  }

  if (commandChanged) {
    Serial.print("Servo angles: ");
    printAngles(currentAngles);
    Serial.println();
  }
}

void applyLinearMotorCommand(const LinearMotorCommand& command) {
  if (!command.valid) {
    return;
  }

  linearMotorCommandEnabled = command.enabled;
  linearMotorEmergencyStop = command.emergencyStop;
  linearMotorWebMode = command.webMode;
  lastLinearMotorCommandReceivedMs = millis();

  const bool hasPowerRequest = abs(command.power[0]) > LINEAR_MOTOR_DEADBAND_PERCENT;
  const bool outputAllowed =
    command.webMode &&
    command.enabled &&
    !command.emergencyStop &&
    hasPowerRequest;

  if (!outputAllowed) {
    finishLinearMotorRun(command.emergencyStop || !command.webMode);
    if (!command.enabled) {
      linearMotorRuntimeLockout = false;
    }
  } else if (linearMotorRuntimeLockout) {
    linearMotorCommandEnabled = false;
    stopLinearMotorImmediately();
    Serial.println("SXTL command ignored: press Stop before restarting after a safety stop.");
  } else if (isLinearMotorCoolingDown()) {
    linearMotorCommandEnabled = false;
    stopLinearMotorImmediately();
    Serial.print("SXTL command ignored: cooling down for ");
    Serial.print((linearMotorCooldownRemainingMs() + 999) / 1000);
    Serial.println(" more seconds.");
  } else if (linearMotorDutyRunElapsedMs() >= LINEAR_MOTOR_DUTY_RUN_LIMIT_MS) {
    linearMotorCommandEnabled = false;
    linearMotorRuntimeLockout = true;
    finishLinearMotorRun(true);
    Serial.println("SXTL stopped: two-minute accumulated duty limit reached.");
  } else {
    const int requestedDirection = command.power[0] > 0 ? 1 : -1;
    if (!linearMotorRunActive) {
      beginLinearMotorLeg(requestedDirection);
    } else if (requestedDirection != linearMotorActiveDirection) {
      accumulateLinearMotorRunTime();
      stopLinearMotorImmediately();
      linearMotorLegRunDurationMs = 0;
      beginLinearMotorLeg(requestedDirection);
    }
    for (int motorIndex = 0; motorIndex < LINEAR_MOTOR_COUNT; motorIndex += 1) {
      linearMotorTargetPower[motorIndex] = command.power[motorIndex];
    }
  }

  Serial.print("Linear actuator command mode=");
  Serial.print(command.webMode ? "WEB" : "OTHER");
  Serial.print(", enabled=");
  Serial.print(command.enabled ? "true" : "false");
  Serial.print(", e-stop=");
  Serial.print(command.emergencyStop ? "true" : "false");
  Serial.print(", M0 target=");
  Serial.print(linearMotorTargetPower[0]);
  Serial.println("%");
}

void enforceLinearMotorSafety() {
  if (WiFi.status() != WL_CONNECTED || !backendDiscovered) {
    if (linearMotorRunActive) {
      linearMotorRuntimeLockout = true;
    }
    finishLinearMotorRun(true);
    return;
  }

  if (linearMotorEmergencyStop) {
    finishLinearMotorRun(true);
    return;
  }

  if (!linearMotorCommandEnabled || !linearMotorWebMode) {
    if (linearMotorRunActive) {
      finishLinearMotorRun(true);
    }
    return;
  }

  if (lastLinearMotorCommandReceivedMs == 0 ||
      millis() - lastLinearMotorCommandReceivedMs > LINEAR_MOTOR_COMMAND_TIMEOUT_MS) {
    linearMotorCommandEnabled = false;
    linearMotorRuntimeLockout = true;
    finishLinearMotorRun(true);
    Serial.println("SXTL stopped: command timeout.");
    return;
  }

  if (linearMotorRunActive &&
      linearMotorDutyRunElapsedMs() >= LINEAR_MOTOR_DUTY_RUN_LIMIT_MS) {
    linearMotorCommandEnabled = false;
    linearMotorRuntimeLockout = true;
    finishLinearMotorRun(true);
    Serial.println("SXTL stopped: two-minute accumulated duty limit reached; cooling for 18 minutes.");
  }
}

void updateLinearMotorRamp() {
  const unsigned long now = millis();
  if (now - lastLinearMotorRampMs < LINEAR_MOTOR_RAMP_INTERVAL_MS) {
    return;
  }
  lastLinearMotorRampMs = now;

  for (int motorIndex = 0; motorIndex < LINEAR_MOTOR_COUNT; motorIndex += 1) {
    int rampTarget = linearMotorTargetPower[motorIndex];
    if ((linearMotorCurrentPower[motorIndex] > 0 && linearMotorTargetPower[motorIndex] < 0) ||
        (linearMotorCurrentPower[motorIndex] < 0 && linearMotorTargetPower[motorIndex] > 0)) {
      rampTarget = 0;
    }

    if (linearMotorCurrentPower[motorIndex] < rampTarget) {
      linearMotorCurrentPower[motorIndex] = min(
        linearMotorCurrentPower[motorIndex] + LINEAR_MOTOR_RAMP_STEP_PERCENT,
        rampTarget
      );
    } else if (linearMotorCurrentPower[motorIndex] > rampTarget) {
      linearMotorCurrentPower[motorIndex] = max(
        linearMotorCurrentPower[motorIndex] - LINEAR_MOTOR_RAMP_STEP_PERCENT,
        rampTarget
      );
    }

    writeLinearMotorPower(motorIndex, linearMotorCurrentPower[motorIndex]);
  }
}

void writeLinearMotorPower(int motorIndex, int powerPercent) {
  if (motorIndex < 0 || motorIndex >= LINEAR_MOTOR_COUNT) {
    return;
  }

  const int power = constrain(
    powerPercent,
    -LINEAR_MOTOR_POWER_LIMIT_PERCENT,
    LINEAR_MOTOR_POWER_LIMIT_PERCENT
  );
  const int duty = map(abs(power), 0, 100, 0, 255);

  if (abs(power) <= LINEAR_MOTOR_DEADBAND_PERCENT) {
    analogWrite(LINEAR_MOTOR_IN_A[motorIndex], 0);
    analogWrite(LINEAR_MOTOR_IN_B[motorIndex], 0);
    return;
  }

  if (power > 0) {
    analogWrite(LINEAR_MOTOR_IN_B[motorIndex], 0);
    analogWrite(LINEAR_MOTOR_IN_A[motorIndex], duty);
  } else {
    analogWrite(LINEAR_MOTOR_IN_A[motorIndex], 0);
    analogWrite(LINEAR_MOTOR_IN_B[motorIndex], duty);
  }
}

void stopLinearMotorImmediately() {
  for (int motorIndex = 0; motorIndex < LINEAR_MOTOR_COUNT; motorIndex += 1) {
    linearMotorTargetPower[motorIndex] = 0;
    linearMotorCurrentPower[motorIndex] = 0;
    analogWrite(LINEAR_MOTOR_IN_A[motorIndex], 0);
    analogWrite(LINEAR_MOTOR_IN_B[motorIndex], 0);
  }
}

void beginLinearMotorLeg(int direction) {
  if (!linearMotorCycleActive) {
    linearMotorCycleActive = true;
    linearMotorReturnLegStarted = false;
    linearMotorFirstDirection = direction;
    linearMotorCycleRunDurationMs = 0;
    linearMotorLegRunDurationMs = 0;
  } else if (direction != linearMotorFirstDirection) {
    if (!linearMotorReturnLegStarted) {
      linearMotorLegRunDurationMs = 0;
    }
    linearMotorReturnLegStarted = true;
  }

  linearMotorActiveDirection = direction;
  linearMotorRunActive = true;
  linearMotorRunStartedMs = millis();

  Serial.print(linearMotorReturnLegStarted ? "SXTL return leg started, direction=" : "SXTL first leg started, direction=");
  Serial.println(direction);
}

void accumulateLinearMotorRunTime() {
  if (!linearMotorRunActive) return;

  const unsigned long runDurationMs = min(
    millis() - linearMotorRunStartedMs,
    LINEAR_MOTOR_MAX_RUN_MS - min(linearMotorLegRunDurationMs, LINEAR_MOTOR_MAX_RUN_MS)
  );
  linearMotorLegRunDurationMs += runDurationMs;
  linearMotorCycleRunDurationMs += runDurationMs;
  linearMotorDutyRunDurationMs = min(
    linearMotorDutyRunDurationMs + runDurationMs,
    LINEAR_MOTOR_DUTY_RUN_LIMIT_MS
  );
  linearMotorRunActive = false;
  linearMotorActiveDirection = 0;
}

void beginLinearMotorCooldown() {
  linearMotorCooldownStartedMs = millis();
  linearMotorCooldownDurationMs = LINEAR_MOTOR_COOLDOWN_DURATION_MS;
  linearMotorCooldownActive = true;
  resetLinearMotorCycle();

  Serial.println("SXTL protection limit reached; cooldown 18 minutes.");
}

void resetLinearMotorCycle() {
  linearMotorCycleActive = false;
  linearMotorReturnLegStarted = false;
  linearMotorFirstDirection = 0;
  linearMotorCycleRunDurationMs = 0;
  linearMotorLegRunDurationMs = 0;
}

void finishLinearMotorRun(bool cancelCycleForSafety) {
  accumulateLinearMotorRunTime();
  stopLinearMotorImmediately();

  // A Stop command clears the runtime lockout but must not restart an active cooldown.
  if (isLinearMotorCoolingDown()) return;

  if (linearMotorDutyRunDurationMs >= LINEAR_MOTOR_DUTY_RUN_LIMIT_MS) {
    beginLinearMotorCooldown();
    return;
  }

  if (!linearMotorCycleActive) return;
  if (cancelCycleForSafety) {
    resetLinearMotorCycle();
    Serial.println("SXTL cycle cancelled by safety stop; accumulated duty time preserved.");
    return;
  }

  if (linearMotorReturnLegStarted) {
    const unsigned long completedCycleRunMs = linearMotorCycleRunDurationMs;
    linearMotorCompletedRoundTrips += 1;
    resetLinearMotorCycle();
    Serial.print("SXTL round trip finished after ");
    Serial.print(completedCycleRunMs / 1000.0f, 1);
    Serial.print(" seconds; completed trips ");
    Serial.print(linearMotorCompletedRoundTrips);
    Serial.print(" / ");
    Serial.print(LINEAR_MOTOR_ROUND_TRIP_LIMIT);
    Serial.print(", accumulated duty ");
    Serial.print(linearMotorDutyRunDurationMs / 1000.0f, 1);
    Serial.println(" / 120 seconds.");

    if (linearMotorCompletedRoundTrips >= LINEAR_MOTOR_ROUND_TRIP_LIMIT) {
      beginLinearMotorCooldown();
      Serial.println("SXTL stopped: four completed round trips; cooling for 18 minutes.");
    } else {
      Serial.println("SXTL is ready for the next round trip without cooldown.");
    }
    return;
  }

  Serial.print("SXTL first leg stopped after ");
  Serial.print(linearMotorCycleRunDurationMs / 1000.0f, 1);
  Serial.println(" seconds; reverse movement is available without cooldown.");
}

const char* linearMotorCyclePhase() {
  if (isLinearMotorCoolingDown()) return "cooling";
  if (linearMotorRunActive) {
    return linearMotorReturnLegStarted ? "returning" : "first_leg";
  }
  if (linearMotorCycleActive) return "awaiting_return";
  return "idle";
}

bool isLinearMotorCoolingDown() {
  if (!linearMotorCooldownActive) {
    return false;
  }

  if (millis() - linearMotorCooldownStartedMs >= linearMotorCooldownDurationMs) {
    linearMotorCooldownActive = false;
    linearMotorCooldownDurationMs = 0;
    linearMotorDutyRunDurationMs = 0;
    linearMotorCompletedRoundTrips = 0;
    Serial.println("SXTL cooldown finished.");
    return false;
  }

  return true;
}

unsigned long linearMotorCooldownRemainingMs() {
  if (!isLinearMotorCoolingDown()) {
    return 0;
  }

  const unsigned long elapsedMs = millis() - linearMotorCooldownStartedMs;
  return linearMotorCooldownDurationMs - elapsedMs;
}

unsigned long linearMotorRunRemainingMs() {
  if (!linearMotorRunActive) {
    return 0;
  }

  const unsigned long elapsedMs =
    linearMotorLegRunDurationMs + (millis() - linearMotorRunStartedMs);
  const unsigned long dutyRemainingMs = linearMotorDutyRemainingMs();
  if (elapsedMs >= LINEAR_MOTOR_MAX_RUN_MS || dutyRemainingMs == 0) {
    return 0;
  }
  return min(LINEAR_MOTOR_MAX_RUN_MS - elapsedMs, dutyRemainingMs);
}

unsigned long linearMotorDutyRunElapsedMs() {
  const unsigned long activeRunMs = linearMotorRunActive
    ? millis() - linearMotorRunStartedMs
    : 0;
  return min(
    linearMotorDutyRunDurationMs + activeRunMs,
    LINEAR_MOTOR_DUTY_RUN_LIMIT_MS
  );
}

unsigned long linearMotorDutyRemainingMs() {
  const unsigned long elapsedMs = linearMotorDutyRunElapsedMs();
  if (elapsedMs >= LINEAR_MOTOR_DUTY_RUN_LIMIT_MS) return 0;
  return LINEAR_MOTOR_DUTY_RUN_LIMIT_MS - elapsedMs;
}

void reportStatus() {
  if (!ensureBackendDiscovered()) {
    return;
  }

  String body = "{";
  body += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  body += "\"device_name\":\"" + String(DEVICE_NAME) + "\",";
  body += "\"angles\":[";
  for (int index = 0; index < SERVO_COUNT; index += 1) {
    if (index > 0) {
      body += ",";
    }
    body += String(currentAngles[index]);
  }
  body += "]}";

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.begin(backendServerBase + "/api/servos/status");
  http.addHeader("X-UISYS-Token", UISYS_API_TOKEN);
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
  if (code < 0) invalidateBackend();
  http.end();

  Serial.print("Status ");
  printAngles(currentAngles);
  Serial.print(", POST /api/servos/status -> ");
  Serial.print(code);
  if (code < 0) {
    Serial.print(" (");
    Serial.print(HTTPClient::errorToString(code).c_str());
    Serial.print(")");
  }
  Serial.println();
}

void reportLinearMotorStatus() {
  if (!ensureBackendDiscovered()) {
    return;
  }

  String body = "{";
  body += "\"device_id\":\"" + String(LINEAR_MOTOR_DEVICE_ID) + "\",";
  body += "\"device_name\":\"" + String(LINEAR_MOTOR_DEVICE_NAME) + "\",";
  body += "\"mode\":\"" + String(linearMotorWebMode ? "WEB" : "MANUAL") + "\",";
  body += "\"enabled\":" + String(linearMotorCommandEnabled ? "true" : "false") + ",";
  body += "\"emergency_stop\":" + String(linearMotorEmergencyStop ? "true" : "false") + ",";
  body += "\"rc_online\":false,";
  body += "\"auto_online\":false,";
  body += "\"runtime_lockout\":" + String(linearMotorRuntimeLockout ? "true" : "false") + ",";
  body += "\"cooldown_remaining_ms\":" + String(linearMotorCooldownRemainingMs()) + ",";
  body += "\"run_active\":" + String(linearMotorRunActive ? "true" : "false") + ",";
  body += "\"run_remaining_ms\":" + String(linearMotorRunRemainingMs()) + ",";
  body += "\"cycle_phase\":\"" + String(linearMotorCyclePhase()) + "\",";
  body += "\"cycle_run_ms\":" + String(
    linearMotorCycleRunDurationMs +
    (linearMotorRunActive ? millis() - linearMotorRunStartedMs : 0)
  ) + ",";
  body += "\"duty_run_ms\":" + String(linearMotorDutyRunElapsedMs()) + ",";
  body += "\"duty_remaining_ms\":" + String(linearMotorDutyRemainingMs()) + ",";
  body += "\"round_trip_count\":" + String(linearMotorCompletedRoundTrips) + ",";
  body += "\"round_trip_limit\":" + String(LINEAR_MOTOR_ROUND_TRIP_LIMIT) + ",";
  body += "\"actual_left_power\":" + String(linearMotorCurrentPower[0]) + ",";
  body += "\"actual_right_power\":0";
  body += "}";

  HTTPClient http;
  http.setTimeout(700);
  http.begin(backendServerBase + "/api/propulsion/status");
  http.addHeader("X-UISYS-Token", UISYS_API_TOKEN);
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
  if (code < 0) invalidateBackend();
  http.end();

  Serial.print("SXTL M0=");
  Serial.print(linearMotorCurrentPower[0]);
  Serial.print("%, POST /api/propulsion/status -> ");
  Serial.print(code);
  if (code < 0) {
    Serial.print(" (");
    Serial.print(HTTPClient::errorToString(code).c_str());
    Serial.print(")");
  }
  Serial.println();
}

void printAngles(const int angles[]) {
  Serial.print("[");
  for (int index = 0; index < SERVO_COUNT; index += 1) {
    if (index > 0) {
      Serial.print(", ");
    }
    Serial.print(angles[index]);
  }
  Serial.print("]");
}
