/*
  MAKER-ESP32-PRO four-servo WiFi controller - board 02.

  Data path:
  Web page -> Express backend -> ESP32 polls commands -> four servos move.

  Arduino IDE library:
  - ESP32Servo

  MAKER-ESP32-PRO onboard servo ports:
  Servo 1 -> GPIO25
  Servo 2 -> GPIO26
  Servo 3 -> GPIO32
  Servo 4 -> GPIO33

  This sketch is for the second MAKER-ESP32-PRO servo board.
  Device ID must be unique:
  - First board:  servo-quad-01
  - Second board: servo-quad-02
*/

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <ESP32Servo.h>

const char* WIFI_SSID = "Xiaomi 17";
const char* WIFI_PASSWORD = "jzxxiaomi17";
const char* SERVER_HOST = "10.161.51.97";
const uint16_t SERVER_PORT = 5000;
const char* SERVER_BASE = "http://10.161.51.97:5000";

const char* DEVICE_ID = "servo-quad-02";
const char* DEVICE_NAME = "maker-esp32-pro-servo-02";
const char* FIRMWARE_VERSION = "2026-06-25-express-platform-board-02";

const int SERVO_COUNT = 4;
const int SERVO_PINS[SERVO_COUNT] = {25, 26, 32, 33};
const int SERVO_MIN_US = 500;
const int SERVO_MAX_US = 2400;
const int START_ANGLE = 90;

const unsigned long COMMAND_INTERVAL_MS = 400;
const unsigned long STATUS_INTERVAL_MS = 2000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 5000;

Servo servos[SERVO_COUNT];
int currentAngles[SERVO_COUNT] = {
  START_ANGLE, START_ANGLE, START_ANGLE, START_ANGLE
};

unsigned long lastCommandMs = 0;
unsigned long lastStatusMs = 0;
unsigned long lastWifiAttemptMs = 0;

void setupServos();
void connectWiFi();
void testServerConnection();
void maintainWiFi();
void pollCommands();
bool readServoAngles(const String& payload, int outputAngles[]);
void moveServosSmoothly(const int targetAngles[]);
void reportStatus();
void printAngles(const int angles[]);

void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println("MAKER-ESP32-PRO four-servo controller starting...");
  Serial.print("Firmware: ");
  Serial.println(FIRMWARE_VERSION);
  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);

  setupServos();
  connectWiFi();
}

void loop() {
  maintainWiFi();

  const unsigned long now = millis();
  if (now - lastCommandMs >= COMMAND_INTERVAL_MS) {
    lastCommandMs = now;
    pollCommands();
  }

  if (now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    reportStatus();
  }
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
  http.setTimeout(3000);
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
  http.setTimeout(3000);
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
