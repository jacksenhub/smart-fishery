/*
  MAKER-ESP32-PRO servo + brushed DC motor controller - board 01.

  Data paths:
  - Web page -> Express backend -> ESP32 polls commands -> four servos move.
  - Propulsion API -> ESP32 polls commands -> 37GB555 on M0 moves.
  Arduino IDE libraries:
  - ESP32Servo

  MAKER-ESP32-PRO onboard servo ports:
  Servo 1 -> GPIO25
  Servo 2 -> GPIO26
  Servo 3 -> GPIO32
  Servo 4 -> GPIO33

  37GB555 brushed DC motor:
  - Motor power wires -> M0 output.
  - M0 driver inputs -> GPIO27 / GPIO13.
  - Set the M0 Motor/IO selector to Motor mode.
  - Use the board DC input that matches the motor rated voltage (board range: 6-16V).
  - Do not power the motor from USB. First test without mechanical load.
*/

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <ESP32Servo.h>

const char* WIFI_SSID = "Xiaomi 17";
const char* WIFI_PASSWORD = "jzxxiaomi17";
const char* SERVER_HOST = "10.29.213.97";
const uint16_t SERVER_PORT = 5000;
const char* SERVER_BASE = "http://10.29.213.97:5000";

const char* DEVICE_ID = "servo-quad-01";
const char* DEVICE_NAME = "maker-esp32-pro-servo-01";
const char* DC_MOTOR_DEVICE_ID = "maker-esp32-pro-dc-01";
const char* DC_MOTOR_DEVICE_NAME = "maker-esp32-pro-37gb555-m0";
const char* FIRMWARE_VERSION = "2026-07-17-servo-dc-motor";

const int SERVO_COUNT = 4;
const int SERVO_PINS[SERVO_COUNT] = {25, 26, 32, 33};
const int SERVO_MIN_US = 500;
const int SERVO_MAX_US = 2400;
const int START_ANGLE = 90;

// MAKER-ESP32-PRO M0 H-bridge inputs. The 37GB555 motor connects to M0.
const int DC_MOTOR_IN_A = 27;
const int DC_MOTOR_IN_B = 13;
const int DC_MOTOR_POWER_LIMIT_PERCENT = 35;
const int DC_MOTOR_DEADBAND_PERCENT = 4;
const int DC_MOTOR_RAMP_STEP_PERCENT = 1;

const unsigned long COMMAND_INTERVAL_MS = 400;
const unsigned long STATUS_INTERVAL_MS = 2000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 5000;
const unsigned long HTTP_TIMEOUT_MS = 1000;
const unsigned long DC_MOTOR_COMMAND_INTERVAL_MS = 300;
const unsigned long DC_MOTOR_STATUS_INTERVAL_MS = 1500;
const unsigned long DC_MOTOR_COMMAND_TIMEOUT_MS = 2200;
const unsigned long DC_MOTOR_RAMP_INTERVAL_MS = 20;

Servo servos[SERVO_COUNT];

int currentAngles[SERVO_COUNT] = {
  START_ANGLE, START_ANGLE, START_ANGLE, START_ANGLE
};

int dcMotorTargetPower = 0;
int dcMotorCurrentPower = 0;
bool dcMotorCommandEnabled = false;
bool dcMotorEmergencyStop = false;
bool dcMotorWebMode = false;

unsigned long lastCommandMs = 0;
unsigned long lastStatusMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastDcMotorCommandPollMs = 0;
unsigned long lastDcMotorCommandReceivedMs = 0;
unsigned long lastDcMotorStatusMs = 0;
unsigned long lastDcMotorRampMs = 0;

struct DcMotorCommand {
  bool valid;
  bool enabled;
  bool emergencyStop;
  bool webMode;
  int power;
};

void setupServos();
void setupDcMotor();
void connectWiFi();
void testServerConnection();
void maintainWiFi();
void pollCommands();
void pollDcMotorCommands();
bool readServoAngles(const String& payload, int outputAngles[]);
bool parseDcMotorCommand(const String& payload, DcMotorCommand& command);
bool extractBool(const String& payload, const char* key, bool fallback);
int extractInt(const String& payload, const char* key, int fallback);
void moveServosSmoothly(const int targetAngles[]);
void applyDcMotorCommand(const DcMotorCommand& command);
void enforceDcMotorSafety();
void updateDcMotorRamp();
void writeDcMotorPower(int powerPercent);
void stopDcMotorImmediately();
void reportStatus();
void reportDcMotorStatus();
void printAngles(const int angles[]);

void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println("MAKER-ESP32-PRO servo + 37GB555 controller starting...");
  Serial.print("Firmware: ");
  Serial.println(FIRMWARE_VERSION);
  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);

  setupServos();
  setupDcMotor();
  connectWiFi();
}

void loop() {
  maintainWiFi();
  enforceDcMotorSafety();
  updateDcMotorRamp();

  const unsigned long now = millis();
  if (now - lastDcMotorCommandPollMs >= DC_MOTOR_COMMAND_INTERVAL_MS) {
    lastDcMotorCommandPollMs = now;
    pollDcMotorCommands();
  }

  if (now - lastCommandMs >= COMMAND_INTERVAL_MS) {
    lastCommandMs = now;
    pollCommands();
  }

  if (now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    reportStatus();
  }

  if (now - lastDcMotorStatusMs >= DC_MOTOR_STATUS_INTERVAL_MS) {
    lastDcMotorStatusMs = now;
    reportDcMotorStatus();
  }
}

void setupDcMotor() {
  pinMode(DC_MOTOR_IN_A, OUTPUT);
  pinMode(DC_MOTOR_IN_B, OUTPUT);
  stopDcMotorImmediately();

  Serial.print("37GB555 M0 driver pins: GPIO");
  Serial.print(DC_MOTOR_IN_A);
  Serial.print("/GPIO");
  Serial.println(DC_MOTOR_IN_B);
  Serial.print("DC motor power limit: ");
  Serial.print(DC_MOTOR_POWER_LIMIT_PERCENT);
  Serial.println("%");
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
    Serial.print("WiFi connected, ESP32 IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Server: ");
    Serial.println(SERVER_BASE);
    testServerConnection();
  } else {
    Serial.println("WiFi connect timeout. Will retry.");
  }
}

void testServerConnection() {
  WiFiClient client;
  Serial.print("TCP test ");
  Serial.print(SERVER_HOST);
  Serial.print(":");
  Serial.print(SERVER_PORT);
  Serial.print(" -> ");

  if (client.connect(SERVER_HOST, SERVER_PORT, 3000)) {
    Serial.println("connected");
    client.stop();
  } else {
    Serial.println("failed");
  }
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  // A network outage must never leave the motor running on its last PWM value.
  stopDcMotorImmediately();

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
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.begin(String(SERVER_BASE) + "/api/device/commands?device_id=" + DEVICE_ID);
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

  http.end();
}

void pollDcMotorCommands() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  HTTPClient http;
  http.setTimeout(700);
  http.begin(String(SERVER_BASE) + "/api/propulsion/commands?device_id=" + DC_MOTOR_DEVICE_ID);
  const int code = http.GET();

  if (code == 200) {
    const String payload = http.getString();
    DcMotorCommand command;
    if (parseDcMotorCommand(payload, command)) {
      applyDcMotorCommand(command);
    }
  } else {
    Serial.print("GET DC motor commands failed: ");
    Serial.print(code);
    if (code < 0) {
      Serial.print(" (");
      Serial.print(HTTPClient::errorToString(code).c_str());
      Serial.print(")");
    }
    Serial.println();
  }

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

bool parseDcMotorCommand(const String& payload, DcMotorCommand& command) {
  command.valid = false;

  if (payload.indexOf("\"propulsion2\"") < 0) {
    return false;
  }

  command.enabled = extractBool(payload, "\"enabled\"", false);
  command.emergencyStop = extractBool(payload, "\"emergency_stop\"", true);
  command.webMode = payload.indexOf("\"mode\":\"WEB\"") >= 0;

  const int requestedMaxPower = constrain(
    extractInt(payload, "\"max_power\"", DC_MOTOR_POWER_LIMIT_PERCENT),
    0,
    DC_MOTOR_POWER_LIMIT_PERCENT
  );
  command.power = constrain(
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
  bool moving = true;
  while (moving) {
    moving = false;

    for (int index = 0; index < SERVO_COUNT; index += 1) {
      if (currentAngles[index] < targetAngles[index]) {
        currentAngles[index] = min(currentAngles[index] + 2, targetAngles[index]);
        moving = true;
      } else if (currentAngles[index] > targetAngles[index]) {
        currentAngles[index] = max(currentAngles[index] - 2, targetAngles[index]);
        moving = true;
      }
      servos[index].write(currentAngles[index]);
    }

    if (moving) {
      delay(20);
    }
  }

  Serial.print("Servo angles: ");
  printAngles(currentAngles);
  Serial.println();
}

void applyDcMotorCommand(const DcMotorCommand& command) {
  if (!command.valid) {
    return;
  }

  dcMotorCommandEnabled = command.enabled;
  dcMotorEmergencyStop = command.emergencyStop;
  dcMotorWebMode = command.webMode;
  lastDcMotorCommandReceivedMs = millis();

  const bool outputAllowed = command.webMode && command.enabled && !command.emergencyStop;
  if (!outputAllowed) {
    stopDcMotorImmediately();
  } else {
    dcMotorTargetPower = command.power;
  }

  Serial.print("DC motor command mode=");
  Serial.print(command.webMode ? "WEB" : "OTHER");
  Serial.print(", enabled=");
  Serial.print(command.enabled ? "true" : "false");
  Serial.print(", e-stop=");
  Serial.print(command.emergencyStop ? "true" : "false");
  Serial.print(", target=");
  Serial.print(dcMotorTargetPower);
  Serial.println("%");
}

void enforceDcMotorSafety() {
  if (WiFi.status() != WL_CONNECTED ||
      dcMotorEmergencyStop ||
      !dcMotorCommandEnabled ||
      !dcMotorWebMode) {
    stopDcMotorImmediately();
    return;
  }

  if (lastDcMotorCommandReceivedMs == 0 ||
      millis() - lastDcMotorCommandReceivedMs > DC_MOTOR_COMMAND_TIMEOUT_MS) {
    dcMotorCommandEnabled = false;
    stopDcMotorImmediately();
  }
}

void updateDcMotorRamp() {
  const unsigned long now = millis();
  if (now - lastDcMotorRampMs < DC_MOTOR_RAMP_INTERVAL_MS) {
    return;
  }
  lastDcMotorRampMs = now;

  int rampTarget = dcMotorTargetPower;
  if ((dcMotorCurrentPower > 0 && dcMotorTargetPower < 0) ||
      (dcMotorCurrentPower < 0 && dcMotorTargetPower > 0)) {
    rampTarget = 0;
  }

  if (dcMotorCurrentPower < rampTarget) {
    dcMotorCurrentPower = min(dcMotorCurrentPower + DC_MOTOR_RAMP_STEP_PERCENT, rampTarget);
  } else if (dcMotorCurrentPower > rampTarget) {
    dcMotorCurrentPower = max(dcMotorCurrentPower - DC_MOTOR_RAMP_STEP_PERCENT, rampTarget);
  }

  writeDcMotorPower(dcMotorCurrentPower);
}

void writeDcMotorPower(int powerPercent) {
  const int power = constrain(powerPercent, -DC_MOTOR_POWER_LIMIT_PERCENT, DC_MOTOR_POWER_LIMIT_PERCENT);
  const int duty = map(abs(power), 0, 100, 0, 255);

  if (abs(power) <= DC_MOTOR_DEADBAND_PERCENT) {
    analogWrite(DC_MOTOR_IN_A, 0);
    analogWrite(DC_MOTOR_IN_B, 0);
    return;
  }

  if (power > 0) {
    analogWrite(DC_MOTOR_IN_B, 0);
    analogWrite(DC_MOTOR_IN_A, duty);
  } else {
    analogWrite(DC_MOTOR_IN_A, 0);
    analogWrite(DC_MOTOR_IN_B, duty);
  }
}

void stopDcMotorImmediately() {
  dcMotorTargetPower = 0;
  dcMotorCurrentPower = 0;
  analogWrite(DC_MOTOR_IN_A, 0);
  analogWrite(DC_MOTOR_IN_B, 0);
}

void reportStatus() {
  if (WiFi.status() != WL_CONNECTED) {
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
  http.begin(String(SERVER_BASE) + "/api/servos/status");
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
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

void reportDcMotorStatus() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  String body = "{";
  body += "\"device_id\":\"" + String(DC_MOTOR_DEVICE_ID) + "\",";
  body += "\"device_name\":\"" + String(DC_MOTOR_DEVICE_NAME) + "\",";
  body += "\"mode\":\"" + String(dcMotorWebMode ? "WEB" : "MANUAL") + "\",";
  body += "\"enabled\":" + String(dcMotorCommandEnabled ? "true" : "false") + ",";
  body += "\"emergency_stop\":" + String(dcMotorEmergencyStop ? "true" : "false") + ",";
  body += "\"rc_online\":false,";
  body += "\"auto_online\":false,";
  body += "\"actual_left_power\":" + String(dcMotorCurrentPower) + ",";
  body += "\"actual_right_power\":0";
  body += "}";

  HTTPClient http;
  http.setTimeout(700);
  http.begin(String(SERVER_BASE) + "/api/propulsion/status");
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
  http.end();

  Serial.print("DC motor M0=");
  Serial.print(dcMotorCurrentPower);
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
