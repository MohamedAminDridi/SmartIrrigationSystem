# Node Firmware — Wiring & Library Guide

## Microcontroller
**ESP32 DevKit V1** (or any 38-pin ESP32)

---

## Pin Map

| Component         | ESP32 Pin | Notes                                    |
|-------------------|-----------|------------------------------------------|
| LoRa SCK          | GPIO 18   | Hardware SPI SCK                         |
| LoRa MISO         | GPIO 19   | Hardware SPI MISO                        |
| LoRa MOSI         | GPIO 23   | Hardware SPI MOSI                        |
| LoRa CS (NSS)     | GPIO 5    | Chip select                              |
| LoRa RST          | GPIO 14   | Reset                                    |
| LoRa DIO0         | GPIO 2    | Interrupt — **DO NOT share with outputs** |
| Status LED (opt.) | GPIO 22   | Optional indicator LED (any spare GPIO)   |
| DHT22 DATA        | GPIO 4    | 10kΩ pull-up to 3.3V required            |
| Soil Moisture OUT | GPIO 34   | ADC1 — 3.3V max, DO NOT exceed!          |
| Servo Signal      | GPIO 13   | PWM 500–2400 µs                          |
| Relay IN          | GPIO 27   | Active-LOW (RELAY_ON = LOW)              |

### LoRa RA-02 (SX1278) power
- VCC → 3.3V  (NOT 5V — the RA-02 is 3.3V only)
- GND → GND

### DHT22 wiring
```
VCC ──── 3.3V
DATA ─── GPIO 4  (+ 10kΩ resistor to 3.3V)
GND ──── GND
```

### Soil Moisture Sensor (resistive)
```
VCC  ──── 3.3V
GND  ──── GND
AOUT ──── GPIO 34
```
> **Calibration**: edit DRY (3500) and WET (1200) constants in `readSoilPct()` for your sensor.

### Servo (5V MG90S / SG90)
```
Signal ──── GPIO 13 (via 330Ω resistor recommended)
VCC    ──── 5V (separate supply or ESP32 VIN)
GND    ──── GND (common with ESP32)
```
> 100% open = 90° servo angle. `setValvePercent(75)` → 67.5° → `servo.write(68)`

### Relay Module (active-LOW, e.g. 1-channel 5V)
```
IN  ──── GPIO 27
VCC ──── 5V
GND ──── GND (common with ESP32)
```
- Pump COM → Relay COM, Pump + → Relay NO (Normally Open)
- When relay fires (IN = LOW) → COM connects to NO → pump on

---

## Required Arduino Libraries

Install via **Arduino IDE → Library Manager** or PlatformIO:

| Library         | Version  | Install name                 |
|-----------------|----------|------------------------------|
| LoRa            | ≥ 0.8.0  | `sandeepmistry/LoRa`         |
| DHT sensor      | ≥ 1.4.4  | `Adafruit DHT sensor library`|
| Adafruit Unified| ≥ 1.1.14 | `Adafruit Unified Sensor`    |
| ESP32Servo      | ≥ 0.13.0 | `madhephaestus/ESP32Servo`   |
| ArduinoJson     | ≥ 6.21.0 | `bblanchon/ArduinoJson`      |

> **Board**: ESP32 Dev Module — partition scheme: **Minimal SPIFFS** (1.9 MB APP / 190 KB SPIFFS)  
> This gives a large enough OTA partition for the app.

---

## OTA Flash Sequence (LoRa FUOTA)

```
Admin Panel                   Gateway (WiFi)              Node (LoRa)
     │                              │                          │
     │── POST /ota/deploy/:nodeId ──►│                          │
     │   {firmware_id}               │                          │
     │                              │◄── MQTT ota topic ────── │
     │                              │    {version,url,checksum} │
     │                              │                          │
     │                              │── HTTP GET /api/ota/download/:id
     │                              │◄── .bin stream ───────── │
     │                              │                          │
     │                              │── LoRa OTA_INIT ────────►│
     │                              │◄── LoRa OTA_READY ───────│
     │                              │                          │
     │                              │── LoRa OTA_CHUNK[0] ────►│
     │                              │◄── LoRa OTA_ACK[0] ──────│
     │                              │        … × N chunks …    │
     │                              │── LoRa OTA_FINISH ──────►│
     │                              │◄── LoRa OTA_DONE ────────│
     │                              │                          │
     │                              │              [reboots with new fw]
```

**Approximate time**: 15–25 minutes for a typical 1 MB firmware image over LoRa SF9 BW125.

---

## Updating NODE_ID

Each physical node must have a unique `NODE_ID` that matches the `device_id` field in MongoDB.  
Edit line ~30 of the `.ino` before flashing each unit:

```cpp
const char* NODE_ID = "node-1-433";   // change per unit
const char* FARM_ID = "farm-1";       // informational only
```

The `fw` field in `sendAlive()` is the firmware version reported to the backend — update it after each OTA:

```cpp
doc["fw"] = "1.0.0";   // bump this in the next release
```
