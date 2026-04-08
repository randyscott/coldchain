# ChirpStack & Simulator Setup

## Overview

This step adds:
- **ChirpStack v4**: LoRaWAN network server (device management, payload decoding)
- **ChirpStack Gateway Bridge**: UDP-to-MQTT translator for physical gateways
- **Sensor Simulator**: Publishes realistic fake data in ChirpStack's format

---

## Docker Compose (Recommended for Getting Started)

```bash
# From the project root:
docker compose up -d

# Verify all services are running:
docker compose ps

# Check simulator output:
docker compose logs -f simulator
```

You should see output like:
```
📡 Simulator started — publishing every 30s
  [14:30:00] Walk-in Cooler #1         T:   2.87°C  H: 84.3%  B:3.599V  🟢 Normal
  [14:30:00] Walk-in Freezer #1        T: -18.42°C  H: 61.2%  B:3.599V  🟢 Normal
  [14:30:00] Loading Dock              T:   7.91°C  H: 48.7%  B:3.599V  🟢 Normal
  [14:30:00] Truck Cargo Area          T:   2.34°C  H: 79.5%  B:3.599V  🟢 Normal GPS:(43.074,-89.398)
```

## Verify MQTT Messages

```bash
# Install MQTT client tools
sudo apt install -y mosquitto-clients

# Subscribe to all ChirpStack uplink events:
mosquitto_sub -h localhost -p 1883 \
  -t 'application/+/device/+/event/up' \
  -u coldchain -P coldchain_dev \
  | jq .
```

You'll see JSON events that look exactly like ChirpStack decoded uplinks,
with the sensor measurements in the `.object` field.

## Access ChirpStack Web UI

Open http://localhost:8080 in your browser.
- Default login: `admin` / `admin`
- This UI is for LoRaWAN device management and troubleshooting
- In production, end users don't see this — they use our custom frontend

## ChirpStack Initial Configuration

After first login, configure ChirpStack for the Ezurio sensors:

### 1. Create a Device Profile

- Go to **Device profiles** → **Add device profile**
- Name: `Ezurio RS2621`
- Region: `US915`  (or your applicable region)
- MAC version: `LoRaWAN 1.0.3`
- Regional parameters revision: `A`
- ADR algorithm: `Default ADR`
- Expected uplink interval: 300 (seconds)
- Device class: `Class A`

### 2. Add the Payload Codec

In the device profile, go to the **Codec** tab and paste:

```javascript
// Ezurio RS2621 simplified codec
// Decodes temperature, humidity, battery from the sensor payload.
// For the simulator, the data is already decoded in the .object field,
// but this codec is needed for real hardware.

function decodeUplink(input) {
    var data = {};
    var bytes = input.bytes;

    if (bytes.length >= 4) {
        // Temperature: bytes 0-1, signed int16, divide by 100
        var rawTemp = (bytes[0] << 8) | bytes[1];
        if (rawTemp > 32767) rawTemp -= 65536;
        data.temperature = rawTemp / 100.0;

        // Humidity: byte 2, unsigned, divide by 2
        data.humidity = bytes[2] / 2.0;

        // Battery: byte 3, voltage = value * 0.01 + 2.0
        data.batteryVoltage = bytes[3] * 0.01 + 2.0;
    }

    return { data: data };
}
```

### 3. Create an Application

- Go to **Applications** → **Add application**
- Name: `Cold Chain Monitoring`
- Description: `Temperature monitoring for cold chain compliance`

### 4. Register Devices (For Real Hardware)

For each physical sensor:
- Go to the application → **Add device**
- Name: descriptive name (e.g., "Walk-in Cooler #1")
- Device EUI: from the sensor's label
- Device profile: `Ezurio RS2621`
- Join method: OTAA
- Application key: from the sensor's provisioning data

## k3s Deployment

```bash
# Deploy ChirpStack
kubectl apply -f manifests/chirpstack/

# Wait for pods
kubectl wait --for=condition=Ready pod -l app=chirpstack -n coldchain --timeout=120s

# Access ChirpStack UI
kubectl port-forward svc/chirpstack 8080:8080 -n coldchain

# Build and deploy simulator
docker build -t coldchain/simulator:dev services/simulator/
# Import into k3s:
docker save coldchain/simulator:dev | sudo k3s ctr images import -
kubectl apply -f manifests/base/40-simulator.yaml
```

## Simulator Configuration

The simulator accepts these arguments:

| Argument | Default | Description |
|----------|---------|-------------|
| `--mqtt-host` | localhost | MQTT broker hostname |
| `--mqtt-port` | 1883 | MQTT broker port |
| `--mqtt-user` | coldchain | MQTT username |
| `--mqtt-pass` | coldchain_dev | MQTT password |
| `--interval` | 30 | Seconds between readings |
| `--excursion-rate` | 0.005 | Probability of temperature excursion per reading |

### Running Standalone (Outside Docker/k3s)

```bash
cd services/simulator
pip install -r requirements.txt

# With Mosquitto port-forwarded to localhost:1883:
python simulator.py --interval 10 --excursion-rate 0.02
```

Increase `--excursion-rate` to trigger more frequent alerts during testing.

---

## What the Simulator Produces

Four simulated sensors:

| Sensor | Type | Temp Range | Behavior |
|--------|------|-----------|----------|
| Walk-in Cooler #1 | Fixed | 2-4°C | Stable with compressor cycles |
| Walk-in Freezer #1 | Fixed | -18 to -20°C | Stable with defrost cycles |
| Loading Dock | Fixed | 5-15°C | Variable (outdoor exposure) |
| Truck Cargo Area | Transport | 1-3°C | Moves along GPS route |

Random excursion events simulate door openings, equipment failures,
and other real-world temperature excursion scenarios. These generate
the temperature spikes that the alert engine will detect.

---

## Next Steps

With infrastructure and simulated data flowing, the next piece is the
**Integration Service** — the FastAPI application that:
1. Subscribes to these MQTT messages
2. Writes sensor readings to TimescaleDB
3. Evaluates alert rules
4. Serves the REST API for the frontend
