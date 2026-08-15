/*
  MAKER-ESP32-PRO standalone ATGM336H-5N GPS web reporter.

  Wiring:
  - GPS 5V  -> board 5V
  - GPS GND -> board GND
  - GPS TX  -> Servo 4 signal pin (GPIO33)
  - GPS RX  -> not connected

  Serial monitor:
  - USB debug baud: 115200
  - GPS UART baud: 9600

  Arduino IDE library:
  - TinyGPSPlus
*/

#include <Arduino.h>
#include <HardwareSerial.h>
#include <HTTPClient.h>
#include <TinyGPS++.h>
#include <WiFi.h>
#include <WiFiUdp.h>

const int GPS_RX_PIN = 33;
const int GPS_TX_PIN = -1;
const uint32_t GPS_BAUD = 9600;
const uint32_t DEBUG_BAUD = 115200;

#if __has_include("wifi_secrets.h")
#include "wifi_secrets.h"
#else
#error "Create wifi_secrets.h from wifi_secrets.example.h before compiling."
#endif
const uint16_t BACKEND_DISCOVERY_PORT = 42110;
const uint16_t BACKEND_DISCOVERY_LOCAL_PORT = 42113;
const char* BACKEND_DISCOVERY_REQUEST = "UISYS_DISCOVER_V1";
const char* BACKEND_DISCOVERY_RESPONSE_PREFIX = "UISYS_BACKEND_V1|";
const unsigned long BACKEND_DISCOVERY_RETRY_INTERVAL_MS = 5000;
const char* GPS_DEVICE_ID = "gps-01";

// Set this to true only when raw NMEA sentences need to be inspected.
const bool ECHO_RAW_NMEA = false;
const unsigned long GPS_SERIAL_TIMEOUT_MS = 5000;
const unsigned long GPS_FIX_MAX_AGE_MS = 5000;
const unsigned long STATUS_INTERVAL_MS = 2000;
const unsigned long REPORT_INTERVAL_MS = 2000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 5000;
const unsigned long HTTP_TIMEOUT_MS = 1000;

HardwareSerial gpsSerial(2);
TinyGPSPlus gps;

bool gpsDataReceived = false;
uint32_t gpsByteCount = 0;
unsigned long lastGpsByteMs = 0;
unsigned long lastStatusMs = 0;
unsigned long lastReportMs = 0;
unsigned long lastWifiAttemptMs = 0;
bool wifiConnectedAnnounced = false;
bool wifiPreviouslyConnected = false;
bool backendDiscoveryUdpStarted = false;
bool backendDiscovered = false;
unsigned long lastBackendDiscoveryAttemptMs = 0;
WiFiUDP backendDiscoveryUdp;
IPAddress backendServerIp;
uint16_t backendServerPort = 5000;
String backendServerBase;

void readGps();
bool gpsSerialOnline();
bool gpsFixValid();
void printGpsStatus();
void setupWiFi();
void maintainWiFi();
IPAddress subnetBroadcastAddress();
void invalidateBackend();
bool discoverBackend(unsigned long timeoutMs);
bool ensureBackendDiscovered();
void reportGpsStatus();

void setup() {
  Serial.begin(DEBUG_BAUD);
  delay(500);

  pinMode(GPS_RX_PIN, INPUT_PULLUP);
  gpsSerial.setRxBufferSize(2048);
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  setupWiFi();

  Serial.println();
  Serial.println("ATGM336H-5N standalone GPS web reporter");
  Serial.println("GPS TX -> Servo 4 signal pin GPIO33, GPS RX -> not connected");
  Serial.println("GPS UART=9600, serial monitor=115200");
  Serial.println("GPS API backend is discovered automatically via UDP 42110.");
  Serial.println("Waiting for NMEA data...");
}

void loop() {
  readGps();
  maintainWiFi();

  const unsigned long now = millis();
  if (now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    printGpsStatus();
  }

  if (now - lastReportMs >= REPORT_INTERVAL_MS) {
    lastReportMs = now;
    reportGpsStatus();
    readGps();
  }

  delay(1);
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

void setupWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptMs = millis();

  Serial.print("Connecting WiFi: ");
  Serial.println(WIFI_SSID);
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiConnectedAnnounced) {
      wifiConnectedAnnounced = true;
      Serial.print("WiFi connected, IP=");
      Serial.println(WiFi.localIP());
    }
    if (!wifiPreviouslyConnected) {
      wifiPreviouslyConnected = true;
      invalidateBackend();
      backendDiscoveryUdpStarted = backendDiscoveryUdp.begin(BACKEND_DISCOVERY_LOCAL_PORT) == 1;
    }
    ensureBackendDiscovered();
    return;
  }

  wifiConnectedAnnounced = false;
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
  Serial.println("WiFi reconnecting...");
  WiFi.disconnect(false, false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
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
  backendDiscoveryUdp.print(GPS_DEVICE_ID);
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

    Serial.print(", altitude_m=");
    if (gps.altitude.isValid()) {
      Serial.print(gps.altitude.meters(), 1);
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
    Serial.println("POST /api/gps/status skipped: backend unavailable");
    return;
  }

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
  http.end();
  if (code < 0) invalidateBackend();

  Serial.print("POST /api/gps/status -> ");
  Serial.print(code);
  if (code < 0) {
    Serial.print(" (");
    Serial.print(HTTPClient::errorToString(code).c_str());
    Serial.print(")");
  }
  Serial.println();
}
