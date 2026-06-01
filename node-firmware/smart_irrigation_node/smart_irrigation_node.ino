/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  Smart Irrigation — ESP32 + RA-02 (433MHz) SENSOR NODE       ║
 * ║  RadioLib · LoRa FUOTA · Servo valve · Auto pump state       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Libraries: RadioLib · DHT sensor library · ArduinoJson v7 · ESP32Servo
 * Partition: "Minimal SPIFFS (1.9MB APP with OTA)"
 *
 * ── WIRING ───────────────────────────────────────────────────────
 * RA-02 :  NSS→5  MOSI→23  MISO→19  SCK→18  DIO0→26  RST→14
 * DHT22 :  DATA → GPIO 4   (10k pull-up to 3.3V)
 * Soil  :  AOUT → GPIO 34  (ADC, input only)
 * Battery: AOUT → GPIO 35  (ADC, voltage divider ÷2)
 * Servo :  Signal → GPIO 13  VCC→5V  GND→GND
 *
 * Pump relay: NOT on this node — the gateway controls the pump relay.
 *   When a valve opens, pumpRunning is set true automatically (logical
 *   state only) so the dashboard and 3D twin show "pump ON".
 *   When a real pump + relay is ready, wire it to the gateway GPIO.
 */

#include <SPI.h>
#include <RadioLib.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <Update.h>
#include <ESP32Servo.h>

// ── Identity (MUST match DB device_id) ───────────────────────────
const char* FARM_ID   = "6a13a8b82fa9f532e8ba6293";
const char* DEVICE_ID = "node-1-433";

// ── RA-02 pins ───────────────────────────────────────────────────
#define LORA_NSS    5
#define LORA_DIO0   26      // interrupt — must match physical wiring
#define LORA_RST    14
#define LORA_DIO1   -1

// ── LoRa config ───────────────────────────────────────────────────
#define LORA_FREQ   433.0
#define LORA_BW     125.0
#define LORA_SF     7
#define LORA_CR     5
#define LORA_POWER  14
#define LORA_SYNC   0x12

// ── Sensors ──────────────────────────────────────────────────────
#define DHT_PIN     4
#define DHT_TYPE    DHT22
#define SOIL_PIN    34
#define BAT_PIN     35
#define BAT_DIVIDER 2.0f
#define BAT_MAX_V   4.2f
#define BAT_MIN_V   3.3f

// ── Actuators ────────────────────────────────────────────────────
#define SERVO_PIN   13      // valve servo — 0%→0°  100%→90°

// ── Timing ───────────────────────────────────────────────────────
// LoRa is half-duplex: the node is DEAF while transmitting. Keep telemetry
// infrequent so there's a long RX window for the gateway to land commands.
// (500ms flooded the channel and made valve commands impossible to receive;
//  the DHT22 also can't be sampled faster than once per 2s.)
#define REPORT_INTERVAL_MS  5000UL    // telemetry every 5 s
#define ALIVE_INTERVAL_MS   30000UL   // alive every 30 s

// ── OTA protocol ─────────────────────────────────────────────────
#define OTA_TYPE_INIT    0xA1
#define OTA_TYPE_CHUNK   0xA2
#define OTA_TYPE_FINISH  0xA3
#define OTA_TYPE_ABORT   0xA4
#define OTA_TYPE_READY   0xB1
#define OTA_TYPE_ACK     0xB2
#define OTA_TYPE_NACK    0xB3
#define OTA_TYPE_DONE    0xB4
#define OTA_TYPE_ERROR   0xB5
#define OTA_ID_LEN       11

// ── Objects ──────────────────────────────────────────────────────
SX1278 radio = new Module(LORA_NSS, LORA_DIO0, LORA_RST, LORA_DIO1);
DHT    dht(DHT_PIN, DHT_TYPE);
Servo  valveServo;

// ── State ────────────────────────────────────────────────────────
uint32_t seq          = 0;
uint32_t lastReport   = 0;
uint32_t lastAlive    = 0;
bool     otaActive    = false;
int      valvePercent = 0;   // 0–100 %
// pumpRunning: logical only — no GPIO on this node.
// Set true when valve opens, false when valve closes.
// The gateway controls the real pump relay via its own MQTT command topic.
bool     pumpRunning  = false;

volatile bool packetReady = false;
void IRAM_ATTR onDio0() { packetReady = true; }

// ── Sensor helpers ────────────────────────────────────────────────
float readBatteryPct() {
  uint16_t raw = analogRead(BAT_PIN);
  float v = (raw / 4095.0f) * 3.3f * BAT_DIVIDER;
  float pct = (v - BAT_MIN_V) / (BAT_MAX_V - BAT_MIN_V) * 100.0f;
  return constrain(pct, 0.0f, 100.0f);
}

int readSoilPct() {
  const int DRY_VAL = 3200;
  const int WET_VAL =  900;
  int raw = analogRead(SOIL_PIN);
  return constrain(map(raw, DRY_VAL, WET_VAL, 0, 100), 0, 100);
}

void armReceive() { radio.startReceive(); }

void sendPacket(JsonDocument& doc) {
  String out;
  serializeJson(doc, out);
  radio.standby();          // ensure clean state before every TX
  int txState = radio.transmit(out);
  if (txState != RADIOLIB_ERR_NONE)
    Serial.printf("[TX FAIL] code=%d\n", txState);
  radio.setDio0Action(onDio0, RISING);
  armReceive();             // return to RX after every TX
  packetReady = false;      // CRITICAL: transmit() just raised DIO0 (TxDone), which
                            // our ISR can't tell apart from RxDone. Clearing the flag
                            // here stops loop() from "reading" the empty FIFO and
                            // logging [RX] JSON err: IncompleteInput after every TX.
  Serial.print("[TX] "); Serial.println(out);
}

// ── Actuator control ─────────────────────────────────────────────
// Servo: 100% → 90°  (fully open), 0% → 0° (fully closed)
void setValvePercent(int pct) {
  pct = constrain(pct, 0, 100);
  valvePercent = pct;
  int angle = map(pct, 0, 100, 0, 90);
  valveServo.write(angle);
  Serial.printf("[VALVE] %d%% → %d°\n", pct, angle);
}

// Pump state is purely logical on this node (no relay).
// The gateway handles the physical pump relay from its own MQTT commands.
void setPumpState(bool on) {
  pumpRunning = on;
  Serial.printf("[PUMP] state=%s (logical only — relay on gateway)\n", on ? "ON" : "OFF");
}

// ── Immediate status echo ─────────────────────────────────────────
// Sends a full telemetry packet right after a command so the gateway
// forwards it to the backend immediately (type "telemetry" is the only
// type the gateway publishes to MQTT — "status" was silently dropped).
void sendStatus() {
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();
  JsonDocument doc;
  doc["type"]        = "telemetry";   // gateway forwards this to MQTT ✓
  doc["id"]          = DEVICE_ID;
  doc["farm"]        = FARM_ID;
  doc["soil"]        = readSoilPct();
  if (!isnan(temp))  doc["temp"] = round(temp * 10) / 10.0;
  if (!isnan(hum))   doc["hum"]  = round(hum  * 10) / 10.0;
  doc["bat"]         = (int)readBatteryPct();
  doc["seq"]         = seq++;
  doc["valve_state"] = (valvePercent > 0) ? "open" : "closed";
  doc["valve_pct"]   = valvePercent;
  doc["pump_state"]  = pumpRunning ? "on" : "off";
  sendPacket(doc);
}

// ── Command handler ───────────────────────────────────────────────
// Backend publishes:
//   {"id":"node-1-433","type":"valve_open","payload":{"percent":75},...}
// id field was added to the backend so the node can verify the command
// is meant for it (multiple nodes share the same LoRa channel).
void handleCommand(const char* type, JsonVariant payload) {
  Serial.printf("[CMD] %s\n", type);

  if (strcmp(type, "valve_open") == 0) {
    int pct = 100;
    if (!payload.isNull()) pct = payload["percent"] | 100;
    setValvePercent(constrain(pct, 1, 100));
    // Auto-start pump when valve opens (logical state for dashboard/twin).
    // The real pump relay fires on the gateway side via the reconcileFarmPump()
    // MQTT message that the backend sends in parallel.
    setPumpState(true);
    sendStatus();

  } else if (strcmp(type, "valve_close") == 0) {
    valveServo.write(0);   // force servo to 0° immediately
    delay(300);            // give servo time to reach 0°
    setValvePercent(0);    // update state variable + write 0° again to confirm
    setPumpState(false);
    sendStatus();

  } else if (strcmp(type, "pump_start") == 0) {
    // Gateway relay handles the real pump; we just mirror the state.
    setPumpState(true);
    sendStatus();

  } else if (strcmp(type, "pump_stop") == 0) {
    // Only update logical state if valve is already closed.
    // The gateway-side firmware guards the physical relay the same way.
    if (valvePercent == 0) setPumpState(false);
    else Serial.println("[PUMP] pump_stop ignored — valve still open");
    sendStatus();

  } else {
    Serial.printf("[CMD] Unknown type: %s\n", type);
  }
}

// ── Incoming LoRa handler ─────────────────────────────────────────
void handleIncoming() {
  uint8_t buf[256];
  int len = sizeof(buf);
  int state = radio.readData(buf, len);
  armReceive();
  if (state != RADIOLIB_ERR_NONE || len < 2) return;

  // OTA binary packet (first byte 0xA1–0xB5)?
  if (buf[0] >= 0xA1 && buf[0] <= 0xB5) {
    if (buf[0] == OTA_TYPE_INIT && isForMe(buf, len)) {
      Serial.println("[OTA] OTA_INIT received");
      handleOtaSession(buf, len);
    }
    return;
  }

  // JSON command
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, buf, len);
  if (err) {
    Serial.printf("[RX] JSON err: %s\n", err.c_str());
    return;
  }

  // Filter: accept if "id" matches, OR if "id" is absent (gateway stripped it).
  // The MQTT topic already routes this to the right node; the id check is a
  // double-safety for shared LoRa channels with multiple nodes.
  const char* targetId = doc["id"] | "";
  if (strlen(targetId) > 0 && strcmp(targetId, DEVICE_ID) != 0) {
    Serial.printf("[RX] Ignored — for '%s', I am '%s'\n", targetId, DEVICE_ID);
    return;
  }

  const char* cmdType = doc["type"] | "";
  if (strlen(cmdType) == 0) return;
  handleCommand(cmdType, doc["payload"]);
}

// ── Periodic packets ──────────────────────────────────────────────
void sendAlive() {
  JsonDocument doc;
  doc["type"]        = "alive";
  doc["id"]          = DEVICE_ID;
  doc["farm"]        = FARM_ID;
  doc["fw"]          = "2.0.0";
  doc["bat"]         = (int)readBatteryPct();
  doc["uptime"]      = millis() / 1000;
  doc["valve_state"] = (valvePercent > 0) ? "open" : "closed";
  doc["valve_pct"]   = valvePercent;
  doc["pump_state"]  = pumpRunning ? "on" : "off";
  sendPacket(doc);
}

void sendTelemetry() {
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();
  if (isnan(temp) || isnan(hum)) {
    Serial.println("[WARN] DHT read failed");
    return;
  }
  JsonDocument doc;
  doc["type"]        = "telemetry";
  doc["id"]          = DEVICE_ID;
  doc["farm"]        = FARM_ID;
  doc["soil"]        = readSoilPct();
  doc["temp"]        = round(temp * 10) / 10.0;
  doc["hum"]         = round(hum  * 10) / 10.0;
  doc["bat"]         = (int)readBatteryPct();
  doc["seq"]         = seq++;
  doc["valve_state"] = (valvePercent > 0) ? "open" : "closed";
  doc["valve_pct"]   = valvePercent;
  doc["pump_state"]  = pumpRunning ? "on" : "off";
  sendPacket(doc);
}

// ── Setup ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n== NODE " + String(DEVICE_ID) + " BOOT ==");

  // Sensors
  dht.begin();
  analogSetAttenuation(ADC_11db);

  // Servo — valve closed at boot
  valveServo.setPeriodHertz(50);
  valveServo.attach(SERVO_PIN, 500, 2400);
  valveServo.write(0);
  Serial.println("[INIT] Servo ready (GPIO " + String(SERVO_PIN) + ")");

  // LoRa
  Serial.print("[LoRa] init ... ");
  int s = radio.begin(LORA_FREQ, LORA_BW, LORA_SF, LORA_CR, LORA_SYNC, LORA_POWER);
  if (s == RADIOLIB_ERR_NONE) Serial.println("OK");
  else { Serial.printf("FAILED code=%d — check wiring\n", s); while (true) delay(1000); }
  radio.setCRC(true);
  radio.setDio0Action(onDio0, RISING);
  Serial.printf("[LoRa] %.1fMHz SF%d BW%.0f CR4/%d sync=0x%02X\n",
                LORA_FREQ, LORA_SF, LORA_BW, LORA_CR, LORA_SYNC);

  sendAlive();
  sendTelemetry();
  armReceive();
  Serial.println("[BOOT] Listening for commands...");
}

// ── Loop ─────────────────────────────────────────────────────────
void loop() {
  uint32_t now = millis();

  if (packetReady) {
    packetReady = false;
    handleIncoming();
  }

  if (!otaActive) {
    if (now - lastReport >= REPORT_INTERVAL_MS) {
      lastReport = now;
      sendTelemetry();
    }
    if (now - lastAlive >= ALIVE_INTERVAL_MS) {
      lastAlive = now;
      sendAlive();
    }
  }

  delay(10);
}

// ── OTA helpers ───────────────────────────────────────────────────
void buildOtaHeader(uint8_t* buf, uint8_t type) {
  buf[0] = type; memset(buf + 1, 0, OTA_ID_LEN);
  strncpy((char*)(buf + 1), DEVICE_ID, OTA_ID_LEN - 1);
}
bool isForMe(uint8_t* buf, size_t len) {
  if (len < 1 + OTA_ID_LEN) return false;
  return strncmp((char*)(buf + 1), DEVICE_ID, strlen(DEVICE_ID)) == 0;
}
void sendOtaReady()          { uint8_t p[1+OTA_ID_LEN]; buildOtaHeader(p,OTA_TYPE_READY); radio.transmit(p,sizeof(p)); armReceive(); }
void sendOtaAck(uint16_t i)  { uint8_t p[1+OTA_ID_LEN+2]; buildOtaHeader(p,OTA_TYPE_ACK); p[1+OTA_ID_LEN]=(i>>8)&0xFF; p[2+OTA_ID_LEN]=i&0xFF; radio.transmit(p,sizeof(p)); armReceive(); }
void sendOtaNack(uint16_t i) { uint8_t p[1+OTA_ID_LEN+2]; buildOtaHeader(p,OTA_TYPE_NACK); p[1+OTA_ID_LEN]=(i>>8)&0xFF; p[2+OTA_ID_LEN]=i&0xFF; radio.transmit(p,sizeof(p)); armReceive(); }
void sendOtaDone()           { uint8_t p[1+OTA_ID_LEN]; buildOtaHeader(p,OTA_TYPE_DONE); radio.transmit(p,sizeof(p)); armReceive(); }
void sendOtaError()          { uint8_t p[1+OTA_ID_LEN+1]; buildOtaHeader(p,OTA_TYPE_ERROR); p[1+OTA_ID_LEN]=0x01; radio.transmit(p,sizeof(p)); armReceive(); }

void handleOtaSession(uint8_t* initPkt, size_t initLen) {
  if (initLen < 1+OTA_ID_LEN+4+2+1+1) { sendOtaError(); return; }
  int pos = 1+OTA_ID_LEN;
  uint32_t totalSize  = ((uint32_t)initPkt[pos]<<24)|((uint32_t)initPkt[pos+1]<<16)|
                        ((uint32_t)initPkt[pos+2]<<8)|initPkt[pos+3]; pos+=4;
  uint16_t chunkCount = ((uint16_t)initPkt[pos]<<8)|initPkt[pos+1]; pos+=2;
  uint8_t  perChunk   = initPkt[pos++];
  uint8_t  vLen       = initPkt[pos++];
  char version[20]={0}; memcpy(version, initPkt+pos, min((int)vLen,19));
  Serial.printf("[OTA] v%s size=%u chunks=%u %uB/chunk\n", version, totalSize, chunkCount, perChunk);
  if (!Update.begin(totalSize, U_FLASH)) { sendOtaError(); return; }
  otaActive = true; sendOtaReady();
  uint16_t rxCount = 0; uint32_t lastPktMs = millis();
  while (rxCount < chunkCount) {
    if (millis()-lastPktMs > 30000) { Update.abort(); sendOtaError(); otaActive=false; armReceive(); return; }
    if (!packetReady) { delay(2); continue; }
    packetReady = false;
    uint8_t buf[256]; int len=sizeof(buf);
    int state = radio.readData(buf, len); armReceive();
    if (state != RADIOLIB_ERR_NONE || !isForMe(buf, len)) continue;
    if (buf[0] == OTA_TYPE_CHUNK) {
      if (len < 1+OTA_ID_LEN+2+1) continue;
      int p = 1+OTA_ID_LEN;
      uint16_t idx = ((uint16_t)buf[p]<<8)|buf[p+1]; p+=2;
      uint8_t dLen = buf[p++];
      if (p+dLen > len) { sendOtaNack(idx); continue; }
      if (Update.write(buf+p, dLen) != dLen) { sendOtaNack(idx); continue; }
      rxCount++; lastPktMs = millis(); sendOtaAck(idx);
      if (idx%50==0 || rxCount==chunkCount) Serial.printf("[OTA] %u/%u\n", rxCount, chunkCount);
    } else if (buf[0] == OTA_TYPE_FINISH) break;
    else if (buf[0] == OTA_TYPE_ABORT)   { Update.abort(); otaActive=false; armReceive(); return; }
  }
  if (!Update.end(true)) { sendOtaError(); otaActive=false; armReceive(); return; }
  sendOtaDone(); delay(500); ESP.restart();
}
