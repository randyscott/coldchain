# Integration Service

The integration service is the central piece of custom code in the system.
It bridges the LoRaWAN network layer (ChirpStack/MQTT) with the application
layer (database, alerts, API).

## What It Does

1. **MQTT Consumer** — Subscribes to ChirpStack decoded uplink events, maps
   each device to its tenant/system, and writes readings to TimescaleDB.

2. **REST API** — Serves the React frontend with endpoints for systems,
   devices, readings, alerts, and user management. Every request is scoped
   to the authenticated user's group.

3. **Alert Engine** — Evaluates incoming readings against configurable rules
   (threshold, duration, rate-of-change, connectivity, battery) and dispatches
   notifications via email and SMS.

## Quick Start (Local Development)

The easiest way to develop is to run the integration service directly on
your machine with hot reload, while the infrastructure (TimescaleDB, Mosquitto,
etc.) runs in k3s or docker-compose.

### Prerequisites

```bash
# Ensure you have Python 3.12+
python3 --version

# Ensure these are port-forwarded (if using k3s):
kubectl port-forward svc/timescaledb 5432:5432 -n coldchain &
kubectl port-forward svc/mosquitto 1883:1883 -n coldchain &

# Ensure the database schema is applied:
bash scripts/apply-schema.sh
```

### Run with Hot Reload

```bash
cd services/integration
./run-dev.sh
```

This creates a virtual environment, installs dependencies, and starts
uvicorn with `--reload`. Code changes take effect immediately.

### Deploy to k3s

To run the integration service as a pod inside your k3s cluster instead
of directly on your machine:

```bash
# 1. Build the container image
cd services/integration
docker build -t coldchain/integration:dev .

# 2. Import the image into k3s
#    (k3s uses containerd, not Docker, so we pipe the image in)
docker save coldchain/integration:dev | sudo k3s ctr images import -

# 3. Verify the image is available in k3s
sudo k3s crictl images | grep integration

# 4. Deploy the manifest
kubectl apply -f manifests/base/50-integration.yaml

# 5. Wait for the pod to be ready
kubectl wait --for=condition=Ready pod -l app=integration -n coldchain --timeout=120s

# 6. Check logs to confirm MQTT subscription and data ingestion
kubectl logs -f deploy/integration -n coldchain
```

To access the API from your machine:

```bash
kubectl port-forward svc/integration 8000:8000 -n coldchain &
curl http://localhost:8000/health
```

After making code changes, rebuild and redeploy:

```bash
cd services/integration
docker build -t coldchain/integration:dev .
docker save coldchain/integration:dev | sudo k3s ctr images import -
kubectl rollout restart deploy/integration -n coldchain
kubectl logs -f deploy/integration -n coldchain
```

> **Tip:** During active development, the `./run-dev.sh` approach with hot
> reload is faster than rebuilding the container. Use the k3s deployment
> when you want to test the full containerized stack end-to-end.

### Verify It's Working

```bash
# Health check
curl http://localhost:8000/health

# API docs (interactive)
open http://localhost:8000/docs

# List systems (uses mock auth in dev mode)
curl http://localhost:8000/api/v1/systems | jq .

# List devices
curl http://localhost:8000/api/v1/devices | jq .

# Get dashboard summary
curl http://localhost:8000/api/v1/systems/summary | jq .
```

### With the Simulator Running

Start the simulator in a separate terminal:

```bash
cd services/simulator
pip install -r requirements.txt
python simulator.py --interval 10
```

You should see the integration service log each ingested reading:

```
📥 Walk-in Cooler #1 (a1b2c3d4e5f60001): T=2.87°C H=84.3% B=3.599V RSSI=-78 SNR=8.2
📥 Walk-in Freezer #1 (a1b2c3d4e5f60002): T=-18.42°C H=61.2% B=3.599V RSSI=-92 SNR=3.1
```

And when an excursion occurs:

```
🚨 ALERT TRIGGERED: Cooler High Temp on Walk-in Cooler #1 — 9.23 gt 4.0 for 920s
📧 Email sent: ⚠️ Cold Chain Alert: Cooler High Temp
✅ Alert resolved: Cooler High Temp (event b1234...)
```

### Query Readings via API

```bash
# Get raw readings for a device (last 24h)
DEVICE_ID="d0000000-0000-0000-0000-000000000002"
curl "http://localhost:8000/api/v1/readings/device/$DEVICE_ID" | jq '.[:3]'

# Get hourly aggregates (last 7 days)
curl "http://localhost:8000/api/v1/readings/device/$DEVICE_ID/hourly" | jq '.[:3]'

# Get latest reading for all sensors in a system
SYSTEM_ID="c0000000-0000-0000-0000-000000000001"
curl "http://localhost:8000/api/v1/readings/system/$SYSTEM_ID/latest" | jq .

# List active alerts
curl "http://localhost:8000/api/v1/alerts/events?active_only=true" | jq .

# List alert rules
curl "http://localhost:8000/api/v1/alerts/rules" | jq .
```

## API Reference

Full interactive docs are available at `http://localhost:8000/docs` (Swagger UI)
and `http://localhost:8000/redoc` (ReDoc) when the service is running.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/systems` | List systems |
| GET | `/api/v1/systems/summary` | Dashboard summary |
| GET | `/api/v1/systems/{id}` | Get system details |
| POST | `/api/v1/systems` | Create system (admin) |
| PATCH | `/api/v1/systems/{id}` | Update system (admin) |
| GET | `/api/v1/devices` | List devices (filterable) |
| GET | `/api/v1/devices/{id}` | Get device details |
| POST | `/api/v1/devices` | Register device (admin) |
| PATCH | `/api/v1/devices/{id}` | Update device (admin) |
| GET | `/api/v1/readings/device/{id}` | Raw readings (time range) |
| GET | `/api/v1/readings/device/{id}/hourly` | Hourly aggregates |
| GET | `/api/v1/readings/device/{id}/daily` | Daily aggregates |
| GET | `/api/v1/readings/system/{id}/latest` | Latest per sensor |
| GET | `/api/v1/alerts/rules` | List alert rules |
| POST | `/api/v1/alerts/rules` | Create rule (admin/mgr) |
| PATCH | `/api/v1/alerts/rules/{id}` | Update rule (admin/mgr) |
| DELETE | `/api/v1/alerts/rules/{id}` | Delete rule (admin) |
| GET | `/api/v1/alerts/events` | List alert events |
| POST | `/api/v1/alerts/events/{id}/acknowledge` | Acknowledge alert |

### Authentication

In development mode (`COLDCHAIN_AUTH_ENABLED=false`), all requests use a
mock admin user belonging to the "Demo Organization" group. No token needed.

In production, pass a Keycloak JWT as a Bearer token:

```
Authorization: Bearer <token>
```

The token must contain `group_id` and `role` claims (configured in Keycloak's
client mappers).

## Architecture Notes

### MQTT Ingestion Path

```
ChirpStack → MQTT (application/+/device/+/event/up)
           → mqtt_ingestion.py: _process_uplink()
             → Write to sensor_readings (asyncpg, direct for speed)
             → Update devices.last_seen_at, battery, signal
             → Call alert_engine.evaluate_reading()
               → Check threshold/duration rules
               → Create alert_events if triggered
               → Send notifications (email/SMS)
```

### Device Cache

The MQTT ingestion path looks up each device by DevEUI on every reading.
To avoid a database query per reading, device info is cached in memory.
The cache is invalidated when devices are created or updated via the API.

### Alert State

Alert state (active breaches, triggered alerts) is held in memory in the
alert engine. This means alert state is lost on service restart. Active
alerts are recoverable from the database (alert_events with resolved_at IS NULL),
but in-progress breach timers reset. This is acceptable for the current
scale; for production, alert state should be persisted to Redis.

## Configuration

All settings via environment variables prefixed with `COLDCHAIN_`:

| Variable | Default | Description |
|----------|---------|-------------|
| `COLDCHAIN_DATABASE_URL` | `postgresql+asyncpg://...` | Database connection |
| `COLDCHAIN_MQTT_HOST` | `localhost` | MQTT broker host |
| `COLDCHAIN_MQTT_PORT` | `1883` | MQTT broker port |
| `COLDCHAIN_MQTT_USERNAME` | `coldchain` | MQTT username |
| `COLDCHAIN_MQTT_PASSWORD` | `coldchain_dev` | MQTT password |
| `COLDCHAIN_AUTH_ENABLED` | `false` | Enable Keycloak auth |
| `COLDCHAIN_ENVIRONMENT` | `development` | Environment name |
| `COLDCHAIN_LOG_LEVEL` | `INFO` | Logging level |
| `COLDCHAIN_SMTP_HOST` | `localhost` | SMTP server for email alerts |
| `COLDCHAIN_SMTP_PORT` | `1025` | SMTP port (1025=MailHog) |
| `COLDCHAIN_TWILIO_ACCOUNT_SID` | (empty) | Twilio SID for SMS |
| `COLDCHAIN_TWILIO_AUTH_TOKEN` | (empty) | Twilio auth token |
| `COLDCHAIN_TWILIO_FROM_NUMBER` | (empty) | Twilio sender number |
