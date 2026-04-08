"""
Cold Chain Monitoring — Sensor Data Simulator
==============================================

Publishes simulated sensor data to MQTT in the same JSON format that
ChirpStack produces for decoded uplink events. This allows full
end-to-end development without physical LoRaWAN hardware.

Usage:
    pip install paho-mqtt
    python simulator.py

    # Or with custom settings:
    python simulator.py --mqtt-host localhost --mqtt-port 1883 --interval 30

Simulated scenarios:
    - Walk-in Cooler: stable ~2-4°C with occasional door-open spikes
    - Walk-in Freezer: stable ~-18 to -20°C with occasional defrost cycles
    - Loading Dock: variable 5-15°C depending on activity
    - Truck Cargo: temperature varies with route, includes GPS track
"""

import argparse
import json
import math
import random
import signal
import sys
import time
from datetime import datetime, timezone
from dataclasses import dataclass, field

import paho.mqtt.client as mqtt


# =============================================================================
# Simulated Device Definitions
# =============================================================================

@dataclass
class SimulatedSensor:
    """Defines a simulated sensor and its behavior."""
    dev_eui: str
    name: str
    application_id: str
    # Temperature behavior
    base_temp: float          # Normal operating temperature (°C)
    temp_variance: float      # Normal random variance (°C)
    # Humidity
    base_humidity: float
    humidity_variance: float
    # Battery (slowly drains)
    battery_voltage: float = 3.6
    battery_drain_per_hour: float = 0.001
    # Location (for transport)
    latitude: float = 0.0
    longitude: float = 0.0
    is_transport: bool = False
    # Internal state
    current_temp: float = field(init=False)
    excursion_active: bool = False
    excursion_start: float = 0.0
    door_open: bool = False
    frame_counter: int = 0

    def __post_init__(self):
        self.current_temp = self.base_temp


# GPS route for the truck (Madison, WI area — a simple delivery loop)
TRUCK_ROUTE = [
    (43.0731, -89.4012),  # Start: warehouse
    (43.0750, -89.3950),
    (43.0800, -89.3850),
    (43.0850, -89.3750),  # Delivery stop 1
    (43.0900, -89.3700),
    (43.0950, -89.3650),
    (43.1000, -89.3600),  # Delivery stop 2
    (43.0950, -89.3700),
    (43.0900, -89.3800),
    (43.0850, -89.3900),
    (43.0800, -89.3950),
    (43.0731, -89.4012),  # Return to warehouse
]


# Application ID (matches what ChirpStack would assign)
APP_ID = "a0000000-0000-0000-0000-000000000001"

SENSORS = [
    SimulatedSensor(
        dev_eui="a1b2c3d4e5f60001",
        name="Walk-in Cooler #1",
        application_id=APP_ID,
        base_temp=3.0,
        temp_variance=0.5,
        base_humidity=85.0,
        humidity_variance=3.0,
    ),
    SimulatedSensor(
        dev_eui="a1b2c3d4e5f60002",
        name="Walk-in Freezer #1",
        application_id=APP_ID,
        base_temp=-18.0,
        temp_variance=1.0,
        base_humidity=60.0,
        humidity_variance=5.0,
    ),
    SimulatedSensor(
        dev_eui="a1b2c3d4e5f60003",
        name="Loading Dock",
        application_id=APP_ID,
        base_temp=8.0,
        temp_variance=3.0,
        base_humidity=50.0,
        humidity_variance=10.0,
    ),
    SimulatedSensor(
        dev_eui="a1b2c3d4e5f60004",
        name="Truck Cargo Area",
        application_id=APP_ID,
        base_temp=2.0,
        temp_variance=1.0,
        base_humidity=80.0,
        humidity_variance=5.0,
        latitude=43.0731,
        longitude=-89.4012,
        is_transport=True,
    ),
]


# =============================================================================
# Temperature Simulation Logic
# =============================================================================

class TemperatureSimulator:
    """Generates realistic temperature patterns for each sensor type."""

    def __init__(self, excursion_probability: float = 0.005):
        self.excursion_probability = excursion_probability
        self.tick = 0
        self.truck_route_index = 0

    def update(self, sensor: SimulatedSensor) -> dict:
        """
        Generate the next reading for a sensor.
        Returns a dict of measurement values.
        """
        self.tick += 1
        now = time.time()

        # --- Temperature ---
        # Base: sinusoidal drift (simulates compressor cycles / ambient variation)
        cycle = math.sin(self.tick * 0.05) * (sensor.temp_variance * 0.3)
        noise = random.gauss(0, sensor.temp_variance * 0.2)
        temp = sensor.base_temp + cycle + noise

        # Random excursion events (door opens, equipment failure, etc.)
        if not sensor.excursion_active:
            if random.random() < self.excursion_probability:
                sensor.excursion_active = True
                sensor.excursion_start = now
                sensor.door_open = True
                print(f"  ⚠️  {sensor.name}: Excursion started!")
        
        if sensor.excursion_active:
            elapsed = now - sensor.excursion_start
            # Temperature rises during excursion (towards ambient ~20°C)
            excursion_magnitude = min(elapsed / 60.0, 15.0)  # Max 15°C rise over ~15 min
            temp += excursion_magnitude
            
            # Excursion resolves after 2-10 minutes
            if elapsed > random.uniform(120, 600):
                sensor.excursion_active = False
                sensor.door_open = False
                print(f"  ✅  {sensor.name}: Excursion resolved.")

        sensor.current_temp = temp

        # --- Humidity ---
        humidity = sensor.base_humidity + random.gauss(0, sensor.humidity_variance * 0.3)
        # Humidity increases during door-open events
        if sensor.door_open:
            humidity += 10
        humidity = max(0, min(100, humidity))

        # --- Battery ---
        sensor.battery_voltage -= sensor.battery_drain_per_hour / 120  # Per tick (~30s)
        sensor.battery_voltage = max(2.0, sensor.battery_voltage)

        # --- GPS (transport only) ---
        lat, lon = sensor.latitude, sensor.longitude
        if sensor.is_transport:
            # Move along the route
            self.truck_route_index = (self.truck_route_index + 1) % len(TRUCK_ROUTE)
            target = TRUCK_ROUTE[self.truck_route_index]
            # Smooth interpolation toward next waypoint
            lat = sensor.latitude + (target[0] - sensor.latitude) * 0.3
            lon = sensor.longitude + (target[1] - sensor.longitude) * 0.3
            sensor.latitude = lat
            sensor.longitude = lon
            # Truck temp is more variable when moving
            temp += random.gauss(0, 0.5)
            sensor.current_temp = temp

        # --- Frame counter ---
        sensor.frame_counter += 1

        return {
            "temperature": round(temp, 2),
            "humidity": round(humidity, 1),
            "batteryVoltage": round(sensor.battery_voltage, 3),
            "latitude": round(lat, 6) if sensor.is_transport else None,
            "longitude": round(lon, 6) if sensor.is_transport else None,
        }


# =============================================================================
# ChirpStack Uplink Event Format
# =============================================================================

def build_chirpstack_uplink_event(sensor: SimulatedSensor, measurements: dict) -> dict:
    """
    Build a JSON message in the same format ChirpStack v4 publishes
    for decoded uplink events. The integration service subscribes to
    these messages and doesn't need to know they're simulated.
    """
    now = datetime.now(timezone.utc)

    event = {
        "deduplicationId": f"sim-{sensor.dev_eui}-{sensor.frame_counter}",
        "time": now.isoformat(),
        "deviceInfo": {
            "tenantId": "00000000-0000-0000-0000-000000000000",
            "tenantName": "coldchain",
            "applicationId": sensor.application_id,
            "applicationName": "Cold Chain Monitoring",
            "deviceProfileId": "00000000-0000-0000-0000-000000000000",
            "deviceProfileName": "Ezurio RS2621",
            "deviceName": sensor.name,
            "devEui": sensor.dev_eui,
        },
        "devAddr": f"0{sensor.dev_eui[:7]}",
        "adr": True,
        "dr": 3,
        "fCnt": sensor.frame_counter,
        "fPort": 1,
        "confirmed": False,
        "data": "",  # Base64 encoded raw payload (empty for simulator)
        "object": measurements,  # This is the decoded payload — what we care about
        "rxInfo": [
            {
                "gatewayId": "0000000000000001",
                "uplinkId": sensor.frame_counter,
                "rssi": random.randint(-110, -60),
                "snr": round(random.uniform(-5, 12), 1),
                "channel": random.randint(0, 7),
                "rfChain": 0,
                "location": {
                    "latitude": 43.0731,
                    "longitude": -89.4012,
                    "altitude": 260,
                },
                "context": "",
                "metadata": {
                    "region_common_name": "US915",
                    "region_config_id": "us915_0",
                },
                "crcStatus": "CRC_OK",
            }
        ],
        "txInfo": {
            "frequency": 903900000,
            "modulation": {
                "lora": {
                    "bandwidth": 125000,
                    "spreadingFactor": 10,
                    "codeRate": "CR_4_5",
                }
            },
        },
    }

    return event


# =============================================================================
# MQTT Publisher
# =============================================================================

def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print("✅ Connected to MQTT broker")
    else:
        print(f"❌ MQTT connection failed with code {rc}")


def on_disconnect(client, userdata, flags, rc, properties=None):
    print(f"⚠️  Disconnected from MQTT broker (rc={rc})")


def main():
    parser = argparse.ArgumentParser(description="Cold Chain Sensor Simulator")
    parser.add_argument("--mqtt-host", default="localhost", help="MQTT broker host")
    parser.add_argument("--mqtt-port", type=int, default=1883, help="MQTT broker port")
    parser.add_argument("--mqtt-user", default="coldchain", help="MQTT username")
    parser.add_argument("--mqtt-pass", default="coldchain_dev", help="MQTT password")
    parser.add_argument("--interval", type=int, default=30,
                        help="Seconds between readings (default: 30)")
    parser.add_argument("--excursion-rate", type=float, default=0.005,
                        help="Probability of excursion per reading per sensor (default: 0.005)")
    args = parser.parse_args()

    # Setup MQTT
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="coldchain-simulator")
    client.username_pw_set(args.mqtt_user, args.mqtt_pass)
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect

    print(f"🔌 Connecting to MQTT broker at {args.mqtt_host}:{args.mqtt_port}...")
    try:
        client.connect(args.mqtt_host, args.mqtt_port, keepalive=60)
    except ConnectionRefusedError:
        print(f"❌ Could not connect to MQTT broker at {args.mqtt_host}:{args.mqtt_port}")
        print("   Make sure Mosquitto is running:")
        print("   - Docker Compose: docker compose up -d mosquitto")
        print("   - k3s: kubectl port-forward svc/mosquitto 1883:1883 -n coldchain")
        sys.exit(1)

    client.loop_start()

    # Setup simulator
    simulator = TemperatureSimulator(excursion_probability=args.excursion_rate)

    # Graceful shutdown
    running = True
    def signal_handler(sig, frame):
        nonlocal running
        print("\n🛑 Shutting down simulator...")
        running = False
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    print(f"\n📡 Simulator started — publishing every {args.interval}s")
    print(f"   Sensors: {len(SENSORS)}")
    print(f"   Excursion probability: {args.excursion_rate}")
    print(f"   Topic pattern: application/<app_id>/device/<dev_eui>/event/up")
    print("-" * 60)

    try:
        while running:
            for sensor in SENSORS:
                # Generate measurements
                measurements = simulator.update(sensor)

                # Build ChirpStack-format event
                event = build_chirpstack_uplink_event(sensor, measurements)

                # Publish to the same topic ChirpStack would use
                topic = (
                    f"application/{sensor.application_id}"
                    f"/device/{sensor.dev_eui}/event/up"
                )
                payload = json.dumps(event)
                result = client.publish(topic, payload, qos=1)

                # Log
                temp = measurements["temperature"]
                hum = measurements["humidity"]
                batt = measurements["batteryVoltage"]
                status = "🔴 EXCURSION" if sensor.excursion_active else "🟢 Normal"

                gps = ""
                if measurements.get("latitude"):
                    gps = f" GPS:({measurements['latitude']},{measurements['longitude']})"

                print(
                    f"  [{datetime.now().strftime('%H:%M:%S')}] "
                    f"{sensor.name:25s} "
                    f"T:{temp:7.2f}°C  "
                    f"H:{hum:5.1f}%  "
                    f"B:{batt:.3f}V  "
                    f"{status}{gps}"
                )

            print(f"  --- Next reading in {args.interval}s ---")
            
            # Sleep in small increments so we can catch SIGINT quickly
            for _ in range(args.interval * 10):
                if not running:
                    break
                time.sleep(0.1)

    finally:
        client.loop_stop()
        client.disconnect()
        print("Simulator stopped.")


if __name__ == "__main__":
    main()
