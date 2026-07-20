/*
  ESP32 SimpleFOC dual-BLDC propulsion controller.

  Board target:
  - ESP32-WROOM-32E SimpleFOC dual-channel brushless motor driver board
  - DC 12V supply
  - Arduino IDE

  Data path:
  Web page -> Express backend -> ESP32 polls propulsion commands -> two BLDC motors.

  Arduino IDE libraries:
  - SimpleFOC

  Safety defaults:
  - Motor output is disabled by default.
  - PWM pin map has been filled from the board manual/user-provided pin list.
  - This board pin list does not provide separate EN pins, so drivers use 3PWM only.
  - Set PIN_MAP_CONFIRMED = 1 and MOTOR_OUTPUT_ENABLED = 1 only after checking the wiring.
  - First test without propellers.
*/

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <Wire.h>
#include <SimpleFOC.h>

const char* WIFI_SSID = "Xiaomi 17";
const char* WIFI_PASSWORD = "jzxxiaomi17";
const char* SERVER_HOST = "10.161.51.97";
const uint16_t SERVER_PORT = 5000;
const char* SERVER_BASE = "http://10.161.51.97:5000";

const char* DEVICE_ID = "mks-foc-dual-01";
const char* DEVICE_NAME = "esp32-simplefoc-dual-propulsion-01";
const char* FIRMWARE_VERSION = "2026-06-25-simplefoc-dual-propulsion";

/*
  Pin map from board manual/user-provided pin list.

  Left motor:
  U = GPIO32
  V = GPIO33
  W = GPIO25

  Right motor:
  U = GPIO26
  V = GPIO27
  W = GPIO14

  No independent EN pins were provided, so BLDCDriver3PWM is created with
  three PWM pins only.
*/
#define PIN_MAP_CONFIRMED 1
#define MOTOR_OUTPUT_ENABLED 0
#define USE_CURRENT_SENSE 0
#define USE_I2C_ENCODERS 0
#define USE_CLOSED_LOOP_VELOCITY 0

const int LEFT_PWM_U = 32;
const int LEFT_PWM_V = 33;
const int LEFT_PWM_W = 25;

const int RIGHT_PWM_U = 26;
const int RIGHT_PWM_V = 27;
const int RIGHT_PWM_W = 14;

/*
  INA240 inline current sense from FOC_ESP32_X2(303FOCESP21) schematic.
  Only two phases per motor are routed to ESP32 ADC.

  Confirm the INA240 suffix before enabling current sense:
  - INA240A1 gain = 20 V/V
  - INA240A2 gain = 50 V/V
  - INA240A3 gain = 100 V/V
  - INA240A4 gain = 200 V/V
*/
const float CURRENT_SHUNT_OHMS = 0.010f;
const float INA240_GAIN = 20.0f;

const int LEFT_CURRENT_A = 35;
const int LEFT_CURRENT_B = 34;
const int RIGHT_CURRENT_A = 39;
const int RIGHT_CURRENT_B = 36;

/*
  Encoder connector P2 from schematic.
  Designed for I2C magnetic encoders such as AS5600 / MT6701.
*/
const int LEFT_ENCODER_SCL = 18;
const int LEFT_ENCODER_SDA = 19;
const int RIGHT_ENCODER_SCL = 15;
const int RIGHT_ENCODER_SDA = 13;
const uint32_t ENCODER_I2C_SPEED = 400000;

#if MOTOR_OUTPUT_ENABLED && !PIN_MAP_CONFIRMED
#error "Set PIN_MAP_CONFIRMED=1 only after replacing PWM pins with the board manual pin map."
#endif

#if USE_CLOSED_LOOP_VELOCITY && !USE_I2C_ENCODERS
#error "Closed-loop velocity requires USE_I2C_ENCODERS=1."
#endif

/*
  Motor parameters.
  POLE_PAIRS must match your BLDC motor. Common small outrunners are often 7,
  but you must confirm this from the motor model.
*/
const int LEFT_POLE_PAIRS = 7;
const int RIGHT_POLE_PAIRS = 7;

const float POWER_SUPPLY_VOLTAGE = 12.0f;
const float MOTOR_VOLTAGE_LIMIT = 3.0f;       // Start low. Raise carefully after testing.
const float MAX_VELOCITY_RAD_PER_SEC = 24.0f; // 100% web output maps to this velocity.
const float POWER_DEADBAND_PERCENT = 3.0f;
const float POWER_RAMP_STEP_PERCENT = 1.0f;

const int DEFAULT_MAX_POWER_PERCENT = 35;
const unsigned long COMMAND_INTERVAL_MS = 300;
const unsigned long STATUS_INTERVAL_MS = 1000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 5000;
const unsigned long COMMAND_TIMEOUT_MS = 1200;
const unsigned long MOTOR_RAMP_INTERVAL_MS = 20;

BLDCMotor leftMotor = BLDCMotor(LEFT_POLE_PAIRS);
BLDCMotor rightMotor = BLDCMotor(RIGHT_POLE_PAIRS);
BLDCDriver3PWM leftDriver = BLDCDriver3PWM(LEFT_PWM_U, LEFT_PWM_V, LEFT_PWM_W);
BLDCDriver3PWM rightDriver = BLDCDriver3PWM(RIGHT_PWM_U, RIGHT_PWM_V, RIGHT_PWM_W);

#if USE_CURRENT_SENSE
InlineCurrentSense leftCurrentSense = InlineCurrentSense(CURRENT_SHUNT_OHMS, INA240_GAIN, LEFT_CURRENT_A, LEFT_CURRENT_B);
InlineCurrentSense rightCurrentSense = InlineCurrentSense(CURRENT_SHUNT_OHMS, INA240_GAIN, RIGHT_CURRENT_A, RIGHT_CURRENT_B);
#endif

#if USE_I2C_ENCODERS
TwoWire leftEncoderWire = TwoWire(0);
TwoWire rightEncoderWire = TwoWire(1);
MagneticSensorI2C leftEncoder = MagneticSensorI2C(AS5600_I2C);
MagneticSensorI2C rightEncoder = MagneticSensorI2C(AS5600_I2C);
#endif

float targetLeftPower = 0.0f;
float targetRightPower = 0.0f;
float currentLeftPower = 0.0f;
float currentRightPower = 0.0f;

bool commandEnabled = false;
bool emergencyStop = false;
bool webMode = false;
bool motorsReady = false;

unsigned long lastCommandPollMs = 0;
unsigned long lastCommandReceivedMs = 0;
unsigned long lastStatusMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastMotorRampMs = 0;

struct PropulsionCommand {
  bool valid;
  bool enabled;
  bool emergencyStop;
  bool webMode;
  int leftPower;
  int rightPower;
  int maxPower;
};

void connectWiFi();
void maintainWiFi();
void testServerConnection();
void setupMotors();
void pollCommands();
bool parsePropulsionCommand(const String& payload, PropulsionCommand& command);
bool extractBool(const String& payload, const char* key, bool fallback);
int extractInt(const String& payload, const char* key, int fallback);
void applyCommand(const PropulsionCommand& command);
void enforceCommandTimeout();
void updateMotorRamp();
void applyMotorOutput();
void reportStatus();
float approachFloat(float current, float target, float step);
float powerToVelocity(float powerPercent);
float clampFloat(float value, float minValue, float maxValue);

void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println("ESP32 SimpleFOC dual-BLDC propulsion controller starting...");
  Serial.print("Firmware: ");
  Serial.println(FIRMWARE_VERSION);
  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);

  setupMotors();
  connectWiFi();
}

void loop() {
  maintainWiFi();
  enforceCommandTimeout();
  updateMotorRamp();
  applyMotorOutput();

  const unsigned long now = millis();

  if (now - lastCommandPollMs >= COMMAND_INTERVAL_MS) {
    lastCommandPollMs = now;
    pollCommands();
  }

  if (now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    reportStatus();
  }
}

void setupMotors() {
  if (!MOTOR_OUTPUT_ENABLED) {
    Serial.println("Motor output is disabled. Dry-run mode is active.");
    Serial.println("Pin map is configured. Set MOTOR_OUTPUT_ENABLED=1 only after no-prop safety testing.");
    Serial.println("PWM L/R: L=GPIO32/33/25, R=GPIO26/27/14.");
    Serial.println("Current sense pins: L=GPIO35/34, R=GPIO39/36.");
    Serial.println("Encoder I2C pins: L=SCL18/SDA19, R=SCL15/SDA13.");
    return;
  }

#if USE_I2C_ENCODERS
  leftEncoderWire.begin(LEFT_ENCODER_SDA, LEFT_ENCODER_SCL);
  leftEncoderWire.setClock(ENCODER_I2C_SPEED);
  rightEncoderWire.begin(RIGHT_ENCODER_SDA, RIGHT_ENCODER_SCL);
  rightEncoderWire.setClock(ENCODER_I2C_SPEED);

  leftEncoder.init(&leftEncoderWire);
  rightEncoder.init(&rightEncoderWire);
  leftMotor.linkSensor(&leftEncoder);
  rightMotor.linkSensor(&rightEncoder);
  Serial.println("I2C magnetic encoders initialized.");
#endif

  leftDriver.voltage_power_supply = POWER_SUPPLY_VOLTAGE;
  leftDriver.voltage_limit = MOTOR_VOLTAGE_LIMIT;
  rightDriver.voltage_power_supply = POWER_SUPPLY_VOLTAGE;
  rightDriver.voltage_limit = MOTOR_VOLTAGE_LIMIT;

  leftDriver.init();
  rightDriver.init();

#if USE_CURRENT_SENSE
  leftCurrentSense.linkDriver(&leftDriver);
  rightCurrentSense.linkDriver(&rightDriver);
#endif

  leftMotor.linkDriver(&leftDriver);
  rightMotor.linkDriver(&rightDriver);

#if USE_CLOSED_LOOP_VELOCITY
  leftMotor.controller = MotionControlType::velocity;
  rightMotor.controller = MotionControlType::velocity;
#else
  leftMotor.controller = MotionControlType::velocity_openloop;
  rightMotor.controller = MotionControlType::velocity_openloop;
#endif

  leftMotor.voltage_limit = MOTOR_VOLTAGE_LIMIT;
  rightMotor.voltage_limit = MOTOR_VOLTAGE_LIMIT;
  leftMotor.velocity_limit = MAX_VELOCITY_RAD_PER_SEC;
  rightMotor.velocity_limit = MAX_VELOCITY_RAD_PER_SEC;

  leftMotor.init();
  rightMotor.init();

#if USE_CURRENT_SENSE
  if (leftCurrentSense.init()) {
    leftMotor.linkCurrentSense(&leftCurrentSense);
    Serial.println("Left current sense initialized.");
  } else {
    Serial.println("Left current sense init failed.");
  }

  if (rightCurrentSense.init()) {
    rightMotor.linkCurrentSense(&rightCurrentSense);
    Serial.println("Right current sense initialized.");
  } else {
    Serial.println("Right current sense init failed.");
  }
#endif

#if USE_I2C_ENCODERS && USE_CLOSED_LOOP_VELOCITY
  leftMotor.initFOC();
  rightMotor.initFOC();
  Serial.println("FOC initialized for closed-loop velocity mode.");
#endif

  leftDriver.disable();
  rightDriver.disable();
  motorsReady = true;

#if USE_CLOSED_LOOP_VELOCITY
  Serial.println("SimpleFOC motors initialized in velocity closed-loop mode.");
#else
  Serial.println("SimpleFOC motors initialized in velocity_openloop mode.");
#endif
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

  if (client.connect(SERVER_HOST, SERVER_PORT, 2500)) {
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
  http.setTimeout(650);
  http.begin(String(SERVER_BASE) + "/api/propulsion/commands?device_id=" + DEVICE_ID);
  const int code = http.GET();

  if (code == 200) {
    const String payload = http.getString();
    PropulsionCommand command;
    if (parsePropulsionCommand(payload, command)) {
      applyCommand(command);
    }
  } else {
    Serial.print("GET propulsion commands failed: ");
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

bool parsePropulsionCommand(const String& payload, PropulsionCommand& command) {
  command.valid = false;

  if (payload.indexOf("\"propulsion2\"") < 0) {
    return false;
  }

  command.enabled = extractBool(payload, "\"enabled\"", false);
  command.emergencyStop = extractBool(payload, "\"emergency_stop\"", true);
  command.webMode = payload.indexOf("\"mode\":\"WEB\"") >= 0;
  command.leftPower = extractInt(payload, "\"left_power\"", 0);
  command.rightPower = extractInt(payload, "\"right_power\"", 0);
  command.maxPower = extractInt(payload, "\"max_power\"", DEFAULT_MAX_POWER_PERCENT);
  command.maxPower = constrain(command.maxPower, 10, 100);
  command.leftPower = constrain(command.leftPower, -command.maxPower, command.maxPower);
  command.rightPower = constrain(command.rightPower, -command.maxPower, command.maxPower);
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

void applyCommand(const PropulsionCommand& command) {
  if (!command.valid) {
    return;
  }

  commandEnabled = command.enabled;
  emergencyStop = command.emergencyStop;
  webMode = command.webMode;
  lastCommandReceivedMs = millis();

  const bool outputAllowed = command.webMode && command.enabled && !command.emergencyStop;
  targetLeftPower = outputAllowed ? command.leftPower : 0.0f;
  targetRightPower = outputAllowed ? command.rightPower : 0.0f;

  Serial.print("Command mode=");
  Serial.print(command.webMode ? "WEB" : "OTHER");
  Serial.print(", enabled=");
  Serial.print(command.enabled ? "true" : "false");
  Serial.print(", e-stop=");
  Serial.print(command.emergencyStop ? "true" : "false");
  Serial.print(", target L/R=");
  Serial.print(targetLeftPower);
  Serial.print("/");
  Serial.println(targetRightPower);
}

void enforceCommandTimeout() {
  if (lastCommandReceivedMs == 0) {
    targetLeftPower = 0.0f;
    targetRightPower = 0.0f;
    return;
  }

  if (millis() - lastCommandReceivedMs > COMMAND_TIMEOUT_MS) {
    commandEnabled = false;
    targetLeftPower = 0.0f;
    targetRightPower = 0.0f;
  }
}

void updateMotorRamp() {
  const unsigned long now = millis();
  if (now - lastMotorRampMs < MOTOR_RAMP_INTERVAL_MS) {
    return;
  }

  lastMotorRampMs = now;
  currentLeftPower = approachFloat(currentLeftPower, targetLeftPower, POWER_RAMP_STEP_PERCENT);
  currentRightPower = approachFloat(currentRightPower, targetRightPower, POWER_RAMP_STEP_PERCENT);
}

void applyMotorOutput() {
  if (!MOTOR_OUTPUT_ENABLED || !motorsReady) {
    return;
  }

#if USE_I2C_ENCODERS && USE_CLOSED_LOOP_VELOCITY
  leftMotor.loopFOC();
  rightMotor.loopFOC();
#endif

  const bool active = commandEnabled && webMode && !emergencyStop &&
                      (abs(currentLeftPower) > POWER_DEADBAND_PERCENT ||
                       abs(currentRightPower) > POWER_DEADBAND_PERCENT);

  if (!active) {
    leftMotor.move(0.0f);
    rightMotor.move(0.0f);
    leftDriver.disable();
    rightDriver.disable();
    return;
  }

  leftDriver.enable();
  rightDriver.enable();
  leftMotor.move(powerToVelocity(currentLeftPower));
  rightMotor.move(powerToVelocity(currentRightPower));
}

void reportStatus() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  String body = "{";
  body += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  body += "\"device_name\":\"" + String(DEVICE_NAME) + "\",";
  body += "\"mode\":\"" + String(webMode ? "WEB" : "MANUAL") + "\",";
  body += "\"enabled\":" + String(commandEnabled ? "true" : "false") + ",";
  body += "\"emergency_stop\":" + String(emergencyStop ? "true" : "false") + ",";
  body += "\"rc_online\":false,";
  body += "\"auto_online\":false,";
  body += "\"actual_left_power\":" + String((int)round(currentLeftPower)) + ",";
  body += "\"actual_right_power\":" + String((int)round(currentRightPower));
  body += "}";

  HTTPClient http;
  http.setTimeout(650);
  http.begin(String(SERVER_BASE) + "/api/propulsion/status");
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
  http.end();

  Serial.print("Status L/R=");
  Serial.print(currentLeftPower);
  Serial.print("/");
  Serial.print(currentRightPower);
  Serial.print(", POST /api/propulsion/status -> ");
  Serial.println(code);
}

float approachFloat(float current, float target, float step) {
  if (current < target) {
    return min(current + step, target);
  }
  if (current > target) {
    return max(current - step, target);
  }
  return current;
}

float powerToVelocity(float powerPercent) {
  if (abs(powerPercent) <= POWER_DEADBAND_PERCENT) {
    return 0.0f;
  }
  return clampFloat(powerPercent / 100.0f, -1.0f, 1.0f) * MAX_VELOCITY_RAD_PER_SEC;
}

float clampFloat(float value, float minValue, float maxValue) {
  return max(minValue, min(maxValue, value));
}
