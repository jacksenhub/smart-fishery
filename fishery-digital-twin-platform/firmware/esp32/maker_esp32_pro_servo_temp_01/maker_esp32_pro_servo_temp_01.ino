 /*
  MAKER-ESP32-PRO three-servo + GPS + three 12V motor controller - board 01.

  Data paths:
  - Web page -> Express backend -> ESP32 polls commands -> three servos move.
  - GPS -> ESP32 UART2 -> Express backend -> web map.
  - Propulsion API -> ESP32 polls the M0 motor and the synchronized M1/M2 pair.
  Arduino IDE libraries:
  - ESP32Servo
  - TinyGPSPlus

  MAKER-ESP32-PRO onboard servo ports:
  Servo 1 -> GPIO25
  Servo 2 -> GPIO26
  Servo 3 -> GPIO32
  Servo 4 signal (GPIO33) -> GPS TX
  GPS 5V -> Servo 4 5V, GPS GND -> Servo 4 GND
  GPS RX -> not connected

  12V brushed DC motors:
  - 37GB555 power wires -> M0 output.
  - M0 driver inputs -> GPIO27 / GPIO13.
  - Pushrod 1 power wires -> M1 output (GPIO4 / GPIO2).
  - Pushrod 2 power wires -> M2 output (GPIO17 / GPIO12).
  - Set M2 Motor/IO selector to Motor mode.
  - Use the board DC input that matches the motor rated voltage (board range: 6-16V).
  - Do not power the motor from USB. First test without mechanical load.
*/

#include <Arduino.h>
#include <ESP32Servo.h>
#include <HardwareSerial.h>
#include <HTTPClient.h>
#include <TinyGPS++.h>
#include <WiFi.h>
#include <WiFiUdp.h>

#if __has_include("wifi_secrets.h")
#include "wifi_secrets.h"
#else
#error "Create wifi_secrets.h from wifi_secrets.example.h before compiling."
#endif
const uint16_t BACKEND_DISCOVERY_PORT = 42110;
const uint16_t BACKEND_DISCOVERY_LOCAL_PORT = 42111;
const char* BACKEND_DISCOVERY_REQUEST = "UISYS_DISCOVER_V1";
const char* BACKEND_DISCOVERY_RESPONSE_PREFIX = "UISYS_BACKEND_V1|";
const unsigned long BACKEND_DISCOVERY_RETRY_INTERVAL_MS = 5000;

const char* DEVICE_ID = "servo-quad-01";
const char* DEVICE_NAME = "maker-esp32-pro-servo-01";
const int MOTOR_COUNT = 3;
const int MOTOR_DEVICE_COUNT = 2;
const char* MOTOR_DEVICE_IDS[MOTOR_DEVICE_COUNT] = {
  "maker-esp32-pro-dc-01",
  "maker-esp32-pro-linear-02"
};
const char* MOTOR_DEVICE_NAMES[MOTOR_DEVICE_COUNT] = {
  "maker-esp32-pro-37gb555-m0",
  "maker-esp32-pro-dual-pushrod-m1-m2"
};
const char* MOTOR_PORT_NAMES[MOTOR_COUNT] = {"M0", "M1", "M2"};
const char* GPS_DEVICE_ID = "gps-01";
const char* FIRMWARE_VERSION = "2026-08-03-board1-responsive-gimbal-tracking";

// The web API still exchanges four angles. Only the first three are physical;
// channel 4 remains at 90 degrees because its GPIO33 signal pin is used by GPS.
const int SERVO_CHANNEL_COUNT = 4;
const int SERVO_COUNT = 3;
const int SERVO_PINS[SERVO_COUNT] = {25, 26, 32};
const int SERVO_MIN_US = 500;
const int SERVO_MAX_US = 2400;
const int START_ANGLE = 90;
// GPIO25/GPIO26 drive the gimbal and are capped below the servo's electrical
// 180-degree range to protect the camera mount. GPIO32 keeps its full range.
const int SERVO_MAX_ANGLES[SERVO_CHANNEL_COUNT] = {160, 160, 180, 90};

const int GPS_RX_PIN = 33;
const int GPS_TX_PIN = -1;
const uint32_t GPS_BAUD = 9600;
const bool ECHO_RAW_NMEA = false;
const unsigned long GPS_SERIAL_TIMEOUT_MS = 5000;
const unsigned long GPS_FIX_MAX_AGE_MS = 5000;
const unsigned long GPS_STATUS_INTERVAL_MS = 2000;
const unsigned long GPS_REPORT_INTERVAL_MS = 2000;

// MAKER-ESP32-PRO H-bridge inputs: M0 is 37GB555; M1/M2 are the pushrod pair.
const int MOTOR_IN_A[MOTOR_COUNT] = {27, 4, 17};
const int MOTOR_IN_B[MOTOR_COUNT] = {13, 2, 12};
const uint32_t MOTOR_PWM_FREQUENCY_HZ = 1000;
// M0, M1 and M2 may be commanded up to full PWM output.
const int MOTOR_POWER_LIMIT_PERCENT[MOTOR_COUNT] = {100, 100, 100};
const int MOTOR_DEADBAND_PERCENT = 4;
const int MOTOR_RAMP_STEP_PERCENT = 1;

// A shorter servo poll interval reduces camera-to-gimbal control latency while
// leaving the motor command and safety timers independent.
const unsigned long COMMAND_INTERVAL_MS = 180;
const unsigned long STATUS_INTERVAL_MS = 2000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 5000;
const unsigned long HTTP_TIMEOUT_MS = 1000;
// One motor is polled/reported per tick. Each channel therefore receives a
// command poll every 300 ms and a status report every 1500 ms.
const unsigned long MOTOR_COMMAND_TICK_MS = 150;
const unsigned long MOTOR_STATUS_TICK_MS = 750;
const unsigned long MOTOR_COMMAND_TIMEOUT_MS = 2200;
const unsigned long MOTOR_RAMP_INTERVAL_MS = 20;

Servo servos[SERVO_COUNT];
HardwareSerial gpsSerial(2);
TinyGPSPlus gps;
WiFiUDP backendDiscoveryUdp;
IPAddress backendServerIp;
uint16_t backendServerPort = 5000;
String backendServerBase;
bool backendDiscovered = false;
bool backendDiscoveryUdpStarted = false;
bool wifiPreviouslyConnected = false;

int currentAngles[SERVO_CHANNEL_COUNT] = {
  START_ANGLE, START_ANGLE, START_ANGLE, START_ANGLE
};

bool gpsDataReceived = false;
uint32_t gpsByteCount = 0;
int motorTargetPower[MOTOR_COUNT] = {0, 0, 0};
int motorCurrentPower[MOTOR_COUNT] = {0, 0, 0};
bool motorCommandEnabled[MOTOR_COUNT] = {false, false, false};
bool motorEmergencyStop[MOTOR_COUNT] = {false, false, false};
bool motorWebMode[MOTOR_COUNT] = {false, false, false};

unsigned long lastCommandMs = 0;
unsigned long lastStatusMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastMotorCommandPollMs = 0;
unsigned long lastMotorCommandReceivedMs[MOTOR_COUNT] = {0, 0, 0};
unsigned long lastMotorStatusMs = 0;
unsigned long lastMotorRampMs = 0;
int nextMotorCommandIndex = 0;
int nextMotorStatusIndex = 0;
unsigned long lastGpsByteMs = 0;
unsigned long lastGpsStatusMs = 0;
unsigned long lastGpsReportMs = 0;
unsigned long lastBackendDiscoveryAttemptMs = 0;

struct MotorCommand {
  bool valid;
  bool enabled;
  bool emergencyStop;
  bool webMode;
  int power[MOTOR_COUNT];
};

void setupServos();
void setupGps();
void setupMotors();
void connectWiFi();
bool discoverBackend(unsigned long timeoutMs);
bool ensureBackendDiscovered();
void invalidateBackend();
IPAddress subnetBroadcastAddress();
void testServerConnection();
void maintainWiFi();
void pollCommands();
void pollMotorCommands(int deviceIndex);
bool readServoAngles(const String& payload, int outputAngles[]);
bool parseMotorCommand(int deviceIndex, const String& payload, MotorCommand& command);
bool extractBool(const String& payload, const char* key, bool fallback);
int extractInt(const String& payload, const char* key, int fallback);
void moveServosSmoothly(const int targetAngles[]);
void applyMotorCommand(int deviceIndex, const MotorCommand& command);
void enforceMotorSafety();
void updateMotorRamp();
void writeMotorPower(int motorIndex, int powerPercent);
void stopMotorImmediately(int motorIndex);
void stopAllMotorsImmediately();
void reportStatus();
void reportMotorStatus(int deviceIndex);
int firstMotorForDevice(int deviceIndex);
int motorCountForDevice(int deviceIndex);
void readGps();
bool gpsSerialOnline();
bool gpsFixValid();
void printGpsStatus();
void reportGpsStatus();
void printAngles(const int angles[]);

void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println("MAKER-ESP32-PRO servo + GPS + 37GB555 + dual pushrod controller starting...");
  Serial.print("Firmware: ");
  Serial.println(FIRMWARE_VERSION);
  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);

  setupServos();
  setupGps();
  setupMotors();
  connectWiFi();
}

void loop() {
  readGps();
  maintainWiFi();
  enforceMotorSafety();
  updateMotorRamp();

  const unsigned long now = millis();
  if (now - lastMotorCommandPollMs >= MOTOR_COMMAND_TICK_MS) {
    lastMotorCommandPollMs = now;
    pollMotorCommands(nextMotorCommandIndex);
    nextMotorCommandIndex = (nextMotorCommandIndex + 1) % MOTOR_DEVICE_COUNT;
    readGps();
  }

  if (now - lastCommandMs >= COMMAND_INTERVAL_MS) {
    lastCommandMs = now;
    pollCommands();
    readGps();
  }

  if (now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    reportStatus();
    readGps();
  }

  if (now - lastMotorStatusMs >= MOTOR_STATUS_TICK_MS) {
    lastMotorStatusMs = now;
    reportMotorStatus(nextMotorStatusIndex);
    nextMotorStatusIndex = (nextMotorStatusIndex + 1) % MOTOR_DEVICE_COUNT;
    readGps();
  }

  const unsigned long gpsNow = millis();
  if (gpsNow - lastGpsStatusMs >= GPS_STATUS_INTERVAL_MS) {
    lastGpsStatusMs = gpsNow;
    printGpsStatus();
  }

  if (gpsNow - lastGpsReportMs >= GPS_REPORT_INTERVAL_MS) {
    lastGpsReportMs = gpsNow;
    reportGpsStatus();
    readGps();
  }

  delay(1);
}

void setupMotors() {
  for (int motorIndex = 0; motorIndex < MOTOR_COUNT; motorIndex += 1) {
    pinMode(MOTOR_IN_A[motorIndex], OUTPUT);
    pinMode(MOTOR_IN_B[motorIndex], OUTPUT);
  }
  // Attach all analogWrite channels first, then change their frequency.
  stopAllMotorsImmediately();
  for (int motorIndex = 0; motorIndex < MOTOR_COUNT; motorIndex += 1) {
    analogWriteFrequency(MOTOR_IN_A[motorIndex], MOTOR_PWM_FREQUENCY_HZ);
    analogWriteFrequency(MOTOR_IN_B[motorIndex], MOTOR_PWM_FREQUENCY_HZ);
    Serial.print(MOTOR_PORT_NAMES[motorIndex]);
    Serial.print(" driver pins: GPIO");
    Serial.print(MOTOR_IN_A[motorIndex]);
    Serial.print("/GPIO");
    Serial.println(MOTOR_IN_B[motorIndex]);
  }

  for (int motorIndex = 0; motorIndex < MOTOR_COUNT; motorIndex += 1) {
    Serial.print(MOTOR_PORT_NAMES[motorIndex]);
    Serial.print(" motor power limit: ");
    Serial.print(MOTOR_POWER_LIMIT_PERCENT[motorIndex]);
    Serial.println("%");
  }
  Serial.print("Motor PWM frequency: ");
  Serial.print(MOTOR_PWM_FREQUENCY_HZ);
  Serial.println(" Hz");
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
  Serial.println("Three servos centered at 90 degrees; Servo 4 is reserved for GPS.");
}

void setupGps() {
  pinMode(GPS_RX_PIN, INPUT_PULLUP);
  gpsSerial.setRxBufferSize(2048);
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  Serial.println("GPS TX -> Servo 4 signal GPIO33; GPS RX -> not connected.");
  Serial.println("GPS UART=9600, coordinate system=WGS84.");
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptMs = millis();

  Serial.print("Connecting WiFi");
  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 15000) {
    readGps();
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
    readGps();
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

  // A network outage must never leave either motor running on its last PWM value.
  stopAllMotorsImmediately();

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
    int nextAngles[SERVO_CHANNEL_COUNT];
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

void pollMotorCommands(int deviceIndex) {
  if (!ensureBackendDiscovered() ||
      deviceIndex < 0 ||
      deviceIndex >= MOTOR_DEVICE_COUNT) {
    return;
  }

  HTTPClient http;
  http.setTimeout(700);
  http.begin(
    backendServerBase +
    "/api/propulsion/commands?device_id=" +
    MOTOR_DEVICE_IDS[deviceIndex]
  );
  http.addHeader("X-UISYS-Token", UISYS_API_TOKEN);
  const int code = http.GET();

  if (code == 200) {
    const String payload = http.getString();
    MotorCommand command;
    if (parseMotorCommand(deviceIndex, payload, command)) {
      applyMotorCommand(deviceIndex, command);
    }
  } else {
    Serial.print("GET ");
    Serial.print(MOTOR_DEVICE_IDS[deviceIndex]);
    Serial.print(" motor commands failed: ");
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

  for (int index = 0; index < SERVO_CHANNEL_COUNT; index += 1) {
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
    outputAngles[index] = min(angle, SERVO_MAX_ANGLES[index]);

    if (index < SERVO_CHANNEL_COUNT - 1) {
      cursor = payload.indexOf(',', end);
      if (cursor < 0) {
        return false;
      }
      cursor += 1;
    }
  }

  return true;
}

bool parseMotorCommand(int deviceIndex, const String& payload, MotorCommand& command) {
  command.valid = false;

  if (deviceIndex < 0 ||
      deviceIndex >= MOTOR_DEVICE_COUNT ||
      payload.indexOf("\"propulsion2\"") < 0) {
    return false;
  }

  for (int motorIndex = 0; motorIndex < MOTOR_COUNT; motorIndex += 1) {
    command.power[motorIndex] = 0;
  }
  command.enabled = extractBool(payload, "\"enabled\"", false);
  command.emergencyStop = extractBool(payload, "\"emergency_stop\"", true);
  command.webMode = payload.indexOf("\"mode\":\"WEB\"") >= 0;

  const int firstMotor = firstMotorForDevice(deviceIndex);
  const int deviceMotorCount = motorCountForDevice(deviceIndex);
  int devicePowerLimit = MOTOR_POWER_LIMIT_PERCENT[firstMotor];
  for (int offset = 1; offset < deviceMotorCount; offset += 1) {
    devicePowerLimit = min(
      devicePowerLimit,
      MOTOR_POWER_LIMIT_PERCENT[firstMotor + offset]
    );
  }
  const int requestedMaxPower = constrain(
    extractInt(payload, "\"max_power\"", devicePowerLimit),
    0,
    devicePowerLimit
  );
  command.power[firstMotor] = constrain(
    extractInt(payload, "\"left_power\"", 0),
    -requestedMaxPower,
    requestedMaxPower
  );
  if (deviceMotorCount == 2) {
    command.power[firstMotor + 1] = constrain(
      extractInt(payload, "\"right_power\"", 0),
      -requestedMaxPower,
      requestedMaxPower
    );
  }
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
  // The fourth command value is retained only for API compatibility.
  currentAngles[SERVO_CHANNEL_COUNT - 1] = START_ANGLE;
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
      readGps();
      enforceMotorSafety();
      updateMotorRamp();
      delay(20);
    }
  }

  if (commandChanged) {
    Serial.print("Servo angles: ");
    printAngles(currentAngles);
    Serial.println();
  }
}

void applyMotorCommand(int deviceIndex, const MotorCommand& command) {
  if (!command.valid ||
      deviceIndex < 0 ||
      deviceIndex >= MOTOR_DEVICE_COUNT) {
    return;
  }

  const bool outputAllowed = command.webMode && command.enabled && !command.emergencyStop;
  const int firstMotor = firstMotorForDevice(deviceIndex);
  const int deviceMotorCount = motorCountForDevice(deviceIndex);
  for (int offset = 0; offset < deviceMotorCount; offset += 1) {
    const int motorIndex = firstMotor + offset;
    motorCommandEnabled[motorIndex] = command.enabled;
    motorEmergencyStop[motorIndex] = command.emergencyStop;
    motorWebMode[motorIndex] = command.webMode;
    lastMotorCommandReceivedMs[motorIndex] = millis();

    if (!outputAllowed) {
      stopMotorImmediately(motorIndex);
    } else {
      motorTargetPower[motorIndex] = command.power[motorIndex];
    }
  }

  Serial.print(MOTOR_DEVICE_IDS[deviceIndex]);
  Serial.print(" command mode=");
  Serial.print(command.webMode ? "WEB" : "OTHER");
  Serial.print(", enabled=");
  Serial.print(command.enabled ? "true" : "false");
  Serial.print(", e-stop=");
  Serial.print(command.emergencyStop ? "true" : "false");
  for (int offset = 0; offset < deviceMotorCount; offset += 1) {
    const int motorIndex = firstMotor + offset;
    Serial.print(", ");
    Serial.print(MOTOR_PORT_NAMES[motorIndex]);
    Serial.print(" target=");
    Serial.print(motorTargetPower[motorIndex]);
    Serial.print("%");
  }
  Serial.println();
}

void enforceMotorSafety() {
  for (int motorIndex = 0; motorIndex < MOTOR_COUNT; motorIndex += 1) {
    if (WiFi.status() != WL_CONNECTED ||
        !backendDiscovered ||
        motorEmergencyStop[motorIndex] ||
        !motorCommandEnabled[motorIndex] ||
        !motorWebMode[motorIndex]) {
      stopMotorImmediately(motorIndex);
      continue;
    }

    if (lastMotorCommandReceivedMs[motorIndex] == 0 ||
        millis() - lastMotorCommandReceivedMs[motorIndex] > MOTOR_COMMAND_TIMEOUT_MS) {
      motorCommandEnabled[motorIndex] = false;
      stopMotorImmediately(motorIndex);
    }
  }
}

void updateMotorRamp() {
  const unsigned long now = millis();
  if (now - lastMotorRampMs < MOTOR_RAMP_INTERVAL_MS) {
    return;
  }
  lastMotorRampMs = now;

  for (int motorIndex = 0; motorIndex < MOTOR_COUNT; motorIndex += 1) {
    int rampTarget = motorTargetPower[motorIndex];
    if ((motorCurrentPower[motorIndex] > 0 && motorTargetPower[motorIndex] < 0) ||
        (motorCurrentPower[motorIndex] < 0 && motorTargetPower[motorIndex] > 0)) {
      rampTarget = 0;
    }

    if (motorCurrentPower[motorIndex] < rampTarget) {
      motorCurrentPower[motorIndex] = min(
        motorCurrentPower[motorIndex] + MOTOR_RAMP_STEP_PERCENT,
        rampTarget
      );
    } else if (motorCurrentPower[motorIndex] > rampTarget) {
      motorCurrentPower[motorIndex] = max(
        motorCurrentPower[motorIndex] - MOTOR_RAMP_STEP_PERCENT,
        rampTarget
      );
    }

    writeMotorPower(motorIndex, motorCurrentPower[motorIndex]);
  }
}

void writeMotorPower(int motorIndex, int powerPercent) {
  if (motorIndex < 0 || motorIndex >= MOTOR_COUNT) {
    return;
  }

  const int power = constrain(
    powerPercent,
    -MOTOR_POWER_LIMIT_PERCENT[motorIndex],
    MOTOR_POWER_LIMIT_PERCENT[motorIndex]
  );
  const int duty = map(abs(power), 0, 100, 0, 255);

  if (abs(power) <= MOTOR_DEADBAND_PERCENT) {
    analogWrite(MOTOR_IN_A[motorIndex], 0);
    analogWrite(MOTOR_IN_B[motorIndex], 0);
    return;
  }

  if (power > 0) {
    analogWrite(MOTOR_IN_B[motorIndex], 0);
    analogWrite(MOTOR_IN_A[motorIndex], duty);
  } else {
    analogWrite(MOTOR_IN_A[motorIndex], 0);
    analogWrite(MOTOR_IN_B[motorIndex], duty);
  }
}

void stopMotorImmediately(int motorIndex) {
  if (motorIndex < 0 || motorIndex >= MOTOR_COUNT) {
    return;
  }
  motorTargetPower[motorIndex] = 0;
  motorCurrentPower[motorIndex] = 0;
  analogWrite(MOTOR_IN_A[motorIndex], 0);
  analogWrite(MOTOR_IN_B[motorIndex], 0);
}

void stopAllMotorsImmediately() {
  for (int motorIndex = 0; motorIndex < MOTOR_COUNT; motorIndex += 1) {
    stopMotorImmediately(motorIndex);
  }
}

void reportStatus() {
  if (!ensureBackendDiscovered()) {
    return;
  }

  String body = "{";
  body += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  body += "\"device_name\":\"" + String(DEVICE_NAME) + "\",";
  body += "\"angles\":[";
  for (int index = 0; index < SERVO_CHANNEL_COUNT; index += 1) {
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

void reportMotorStatus(int deviceIndex) {
  if (!ensureBackendDiscovered() ||
      deviceIndex < 0 ||
      deviceIndex >= MOTOR_DEVICE_COUNT) {
    return;
  }

  const int firstMotor = firstMotorForDevice(deviceIndex);
  const int deviceMotorCount = motorCountForDevice(deviceIndex);
  const int rightMotor = deviceMotorCount == 2 ? firstMotor + 1 : -1;
  String body = "{";
  body += "\"device_id\":\"" + String(MOTOR_DEVICE_IDS[deviceIndex]) + "\",";
  body += "\"device_name\":\"" + String(MOTOR_DEVICE_NAMES[deviceIndex]) + "\",";
  body += "\"mode\":\"" + String(motorWebMode[firstMotor] ? "WEB" : "MANUAL") + "\",";
  body += "\"enabled\":" + String(motorCommandEnabled[firstMotor] ? "true" : "false") + ",";
  body += "\"emergency_stop\":" + String(motorEmergencyStop[firstMotor] ? "true" : "false") + ",";
  body += "\"rc_online\":false,";
  body += "\"auto_online\":false,";
  body += "\"actual_left_power\":" + String(motorCurrentPower[firstMotor]) + ",";
  body += "\"actual_right_power\":";
  if (rightMotor >= 0) {
    body += String(motorCurrentPower[rightMotor]);
  } else {
    body += "0";
  }
  body += "}";

  HTTPClient http;
  http.setTimeout(700);
  http.begin(backendServerBase + "/api/propulsion/status");
  http.addHeader("X-UISYS-Token", UISYS_API_TOKEN);
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
  if (code < 0) invalidateBackend();
  http.end();

  Serial.print(MOTOR_DEVICE_IDS[deviceIndex]);
  Serial.print(" ");
  for (int offset = 0; offset < deviceMotorCount; offset += 1) {
    const int motorIndex = firstMotor + offset;
    if (offset > 0) {
      Serial.print(", ");
    }
    Serial.print(MOTOR_PORT_NAMES[motorIndex]);
    Serial.print("=");
    Serial.print(motorCurrentPower[motorIndex]);
    Serial.print("%");
  }
  Serial.print(", POST /api/propulsion/status -> ");
  Serial.print(code);
  if (code < 0) {
    Serial.print(" (");
    Serial.print(HTTPClient::errorToString(code).c_str());
    Serial.print(")");
  }
  Serial.println();
}

int firstMotorForDevice(int deviceIndex) {
  return deviceIndex == 0 ? 0 : 1;
}

int motorCountForDevice(int deviceIndex) {
  return deviceIndex == 0 ? 1 : 2;
}

void readGps() {
  while (gpsSerial.available() > 0) {
    const char value = static_cast<char>(gpsSerial.read());
    gpsDataReceived = true;
    gpsByteCount += 1;
    lastGpsByteMs = millis();

    if (ECHO_RAW_NMEA) {
      Serial.write(value);
    }

    gps.encode(value);
  }
}

bool gpsSerialOnline() {
  return gpsDataReceived &&
         millis() - lastGpsByteMs <= GPS_SERIAL_TIMEOUT_MS;
}

bool gpsFixValid() {
  return gpsSerialOnline() &&
         gps.location.isValid() &&
         gps.location.age() <= GPS_FIX_MAX_AGE_MS;
}

void printGpsStatus() {
  const bool serialOnline = gpsSerialOnline();
  const bool validFix = gpsFixValid();

  Serial.print("[GPS] serial=");
  Serial.print(serialOnline ? "online" : "offline");
  Serial.print(", bytes=");
  Serial.print(gpsByteCount);
  Serial.print(", chars=");
  Serial.print(gps.charsProcessed());
  Serial.print(", fix=");
  Serial.print(validFix ? "valid" : "waiting");

  if (validFix) {
    Serial.print(", lat=");
    Serial.print(gps.location.lat(), 7);
    Serial.print(", lng=");
    Serial.print(gps.location.lng(), 7);
    Serial.print(", satellites=");
    if (gps.satellites.isValid()) {
      Serial.print(gps.satellites.value());
    } else {
      Serial.print("--");
    }
    Serial.print(", hdop=");
    if (gps.hdop.isValid()) {
      Serial.print(gps.hdop.hdop(), 1);
    } else {
      Serial.print("--");
    }
  } else if (!serialOnline) {
    Serial.print(", check 5V/GND/GPS-TX->GPIO33");
  } else {
    Serial.print(", NMEA received; move antenna outdoors and wait");
  }

  Serial.println();
}

void reportGpsStatus() {
  if (!ensureBackendDiscovered()) {
    return;
  }

  readGps();
  const bool serialOnline = gpsSerialOnline();
  const bool validFix = gpsFixValid();
  String body;
  body.reserve(384);
  body = "{";
  body += "\"device_id\":\"" + String(GPS_DEVICE_ID) + "\",";
  body += "\"coordinate_system\":\"WGS84\",";
  body += "\"serial_online\":";
  body += serialOnline ? "true" : "false";
  body += ",\"valid\":";
  body += validFix ? "true" : "false";
  body += ",\"lat\":";
  body += validFix ? String(gps.location.lat(), 7) : "null";
  body += ",\"lng\":";
  body += validFix ? String(gps.location.lng(), 7) : "null";
  body += ",\"satellites\":";
  body += gps.satellites.isValid() ? String(gps.satellites.value()) : "null";
  body += ",\"hdop\":";
  body += gps.hdop.isValid() ? String(gps.hdop.hdop(), 1) : "null";
  body += ",\"altitude_m\":";
  body += gps.altitude.isValid() ? String(gps.altitude.meters(), 1) : "null";
  body += ",\"speed_mps\":";
  body += gps.speed.isValid() ? String(gps.speed.mps(), 2) : "null";
  body += ",\"heading_deg\":";
  body += gps.course.isValid() ? String(gps.course.deg(), 1) : "null";
  body += ",\"chars_processed\":";
  body += String(gps.charsProcessed());
  body += "}";

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.begin(backendServerBase + "/api/gps/status");
  http.addHeader("X-UISYS-Token", UISYS_API_TOKEN);
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
  if (code < 0) invalidateBackend();
  http.end();

  Serial.print("POST /api/gps/status -> ");
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
  for (int index = 0; index < SERVO_CHANNEL_COUNT; index += 1) {
    if (index > 0) {
      Serial.print(", ");
    }
    Serial.print(angles[index]);
  }
  Serial.print("]");
}
