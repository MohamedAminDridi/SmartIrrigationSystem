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
 * Soil  :  AOUT → GPIO 32  (ADC1_CH4)
 * INA219:  VCC→3.3V  GND→GND  SDA→21  SCL→22   (battery monitor, I2C 0x40)
 *          Vin+ → Battery(+)   Vin- → load (ESP32 VIN)   Battery(-) → GND
 * Servo :  Signal → GPIO 13  VCC→5V  GND→GND
 *
 * Battery %: from INA219 bus voltage (3.3V=0% … 4.2V=100%).
 * Charging : detected from current direction (charger pushes current INTO the
 *            battery → negative reading with Vin+/Vin- as wired above).
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
#include <Wire.h>
#include <Adafruit_INA219.h>

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
#define SOIL_PIN    32        // AOUT → GPIO 32 (ADC1_CH4)
#define BAT_PIN     35        // legacy ADC divider — fallback only if INA219 missing
#define BAT_DIVIDER 2.0f
// 3S Li-ion/LiPo pack (3 cells in series): 12.6V full (4.2V/cell) … 9.0V empty (3.0V/cell)
#define BAT_MAX_V   12.6f     // 100% battery voltage
#define BAT_MIN_V   9.0f      // 0% battery voltage

// ── Battery monitor — INA219 over I2C ─────────────────────────────
#define I2C_SDA     21
#define I2C_SCL     22
#define CHARGE_MA   30.0f     // |current| past this (charging sign) = "charging"
#define PACK_R      0.15f     // pack + wiring internal resistance (Ω) for IR compensation
                              //   (tune 0.10–0.25 for a 3S pack; lower if % over-corrects)
#define EMA_ALPHA   0.08f     // battery-% smoothing (0..1) — lower = smoother/slower
#define BAT_DEADBAND 1.5f     // % only moves when it drifts past this (kills flicker)
// ⚠️ SET THIS to your pack's REAL capacity in mAh (printed on the cell/pack).
// 3S series = one cell's mAh (series adds voltage, not capacity). Parallel (xP)
// multiplies: a 3S2P of 2500mAh cells = 5000. Used for coulomb-counted % + time.
#define PACK_CAPACITY_MAH 2500.0f

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
Adafruit_INA219 ina219;
bool   ina219Ready = false;

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

// ── Battery (INA219, with ADC fallback) ───────────────────────────
float readBatteryVoltage() {
  if (ina219Ready) return ina219.getBusVoltage_V();          // V at Vin- ≈ battery V
  uint16_t raw = analogRead(BAT_PIN);                         // fallback: ADC divider
  return (raw / 4095.0f) * 3.3f * BAT_DIVIDER;
}
float readBatteryCurrent_mA() {
  return ina219Ready ? ina219.getCurrent_mA() : 0.0f;         // + = discharge, − = charge
}
// % from the IR-compensated open-circuit voltage, exponentially smoothed.
//  - IR compensation: V_oc = V_terminal + I·R  (I is + when discharging), which
//    removes the voltage "bump" while charging and the "sag" under load, so the
//    % reflects the true state of charge instead of jumping when you plug in.
//  - EMA: blends each new reading so the % glides instead of snapping.
float readBatteryPct() {
  static float vEma = -1.0f;     // smoothed open-circuit voltage
  static float held = -1.0f;     // last reported % (held until it drifts past deadband)
  float v   = readBatteryVoltage();
  float iA  = readBatteryCurrent_mA() / 1000.0f;        // signed amps (+ discharge)
  float voc = v + iA * PACK_R;                           // IR-compensated open-circuit
  vEma = (vEma < 0) ? voc : vEma + EMA_ALPHA * (voc - vEma);
  float pct = constrain((vEma - BAT_MIN_V) / (BAT_MAX_V - BAT_MIN_V) * 100.0f, 0.0f, 100.0f);
  // Hysteresis: only move the reported % once it has truly drifted — no ±1% flicker.
  if (held < 0 || fabs(pct - held) >= BAT_DEADBAND) held = pct;
  return held;
}

// ── Coulomb counter (true fuel gauge) ─────────────────────────────
// Integrates the INA219 current over time into mAh remaining, so % reflects the
// real charge in/out — it does NOT drift up just because the voltage rose under
// charge. Seeded from the voltage estimate at boot, and slowly re-synced to it
// while the pack is at rest (current ~0) to cancel long-term integration drift.
float    g_batMah   = -1.0f;          // mAh remaining (-1 until seeded)
uint32_t g_lastCoul = 0;

void updateCoulomb() {
  uint32_t now = millis();
  float vMah = readBatteryPct() / 100.0f * PACK_CAPACITY_MAH;   // voltage-based estimate
  if (g_batMah < 0) { g_batMah = vMah; g_lastCoul = now; return; }
  float dt_h = (now - g_lastCoul) / 3600000.0f;                 // ms → hours
  g_lastCoul = now;
  float i_mA = readBatteryCurrent_mA();                          // + discharge / − charge
  g_batMah -= i_mA * dt_h;                                       // discharge drains, charge fills
  if (fabs(i_mA) < 20.0f) g_batMah += (vMah - g_batMah) * 0.02f; // rest re-sync (drift fix)
  g_batMah = constrain(g_batMah, 0.0f, PACK_CAPACITY_MAH);
}

int batterySoC() {                                               // coulomb-counted %
  if (g_batMah < 0) return (int)readBatteryPct();
  return (int)constrain(g_batMah / PACK_CAPACITY_MAH * 100.0f, 0.0f, 100.0f);
}

// Minutes remaining: to-empty when discharging, to-full when charging, 0 if idle.
int batteryTimeMin() {
  if (g_batMah < 0 || !ina219Ready) return 0;
  float i = readBatteryCurrent_mA();
  if (i >  5.0f)      return (int)(g_batMah / i * 60.0f);                          // → empty (any real draw)
  if (i < -CHARGE_MA) return (int)((PACK_CAPACITY_MAH - g_batMah) / (-i) * 60.0f); // → full (charging)
  return 0;                                                                        // truly idle
}
// Charging when current flows INTO the battery (negative with our wiring).
// If it reads backwards on your board, flip the comparison sign.
bool batteryCharging() {
  return ina219Ready && readBatteryCurrent_mA() < -CHARGE_MA;
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
  doc["soil"]        = readSoilPct();
  doc["soil_raw"]    = analogRead(SOIL_PIN);   // DEBUG: calibrate DRY_VAL/WET_VAL from this
  if (!isnan(temp))  doc["temp"] = round(temp * 10) / 10.0;
  if (!isnan(hum))   doc["hum"]  = round(hum  * 10) / 10.0;
  doc["bat"]         = batterySoC();
  doc["bat_v"]       = round(readBatteryVoltage() * 100) / 100.0;
  doc["bat_ma"]      = round(readBatteryCurrent_mA() * 10) / 10.0;
  doc["bat_mah"]     = (int)g_batMah;
  doc["time_min"]    = batteryTimeMin();
  doc["charging"]    = batteryCharging();
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
  doc["fw"]          = "2.0.0";
  doc["bat"]         = batterySoC();
  doc["bat_v"]       = round(readBatteryVoltage() * 100) / 100.0;
  doc["bat_ma"]      = round(readBatteryCurrent_mA() * 10) / 10.0;
  doc["bat_mah"]     = (int)g_batMah;
  doc["time_min"]    = batteryTimeMin();
  doc["charging"]    = batteryCharging();
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
  doc["soil"]        = readSoilPct();
  doc["soil_raw"]    = analogRead(SOIL_PIN);   // DEBUG: calibrate DRY_VAL/WET_VAL from this
  doc["temp"]        = round(temp * 10) / 10.0;
  doc["hum"]         = round(hum  * 10) / 10.0;
  doc["bat"]         = batterySoC();
  doc["bat_v"]       = round(readBatteryVoltage() * 100) / 100.0;
  doc["bat_ma"]      = round(readBatteryCurrent_mA() * 10) / 10.0;
  doc["bat_mah"]     = (int)g_batMah;
  doc["time_min"]    = batteryTimeMin();
  doc["charging"]    = batteryCharging();
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

  // Battery monitor (INA219 over I2C)
  Wire.begin(I2C_SDA, I2C_SCL);
  if (ina219.begin()) { ina219Ready = true; Serial.println("[INIT] INA219 battery monitor ready (I2C 0x40)"); }
  else                  Serial.println("[WARN] INA219 not found — falling back to ADC battery");

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

  // Coulomb counter — integrate battery current every second
  static uint32_t lastCoul = 0;
  if (now - lastCoul >= 1000) { lastCoul = now; updateCoulomb(); }

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
