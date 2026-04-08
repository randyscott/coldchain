# Cold Chain Compliance Monitoring System

A multi-tenant, cloud-hosted cold chain compliance monitoring platform built around LoRaWAN sensor technology. Designed for FSMA/HACCP compliance in food safety applications.

## Architecture

| Layer | Component | Technology |
|-------|-----------|------------|
| Edge | Gateways & Sensors | Ezurio RG1xx, RS26x (expandable) |
| Network | LoRaWAN Network Server | ChirpStack v4 |
| Message Bus | MQTT Broker | Eclipse Mosquitto |
| Integration | API / Business Logic | Python / FastAPI |
| Storage | Time-Series & Relational | TimescaleDB (PostgreSQL) |
| Presentation | Web Frontend | React + TypeScript |
| Identity | Auth & RBAC | Keycloak |

## Quick Start (Docker Compose)

```bash
# 1. Generate Mosquitto passwords
sudo apt install -y mosquitto-clients
mosquitto_passwd -c -b config/mosquitto/password_file coldchain coldchain_dev
mosquitto_passwd -b config/mosquitto/password_file chirpstack chirpstack_mqtt_dev

# 2. Start infrastructure
docker compose up -d

# 3. Verify services
docker compose ps

# 4. Database schema is auto-applied via init scripts
# Verify:
docker compose exec timescaledb psql -U coldchain -d coldchain -c "\dt"
```

## Quick Start (k3s)

See [docs/01-local-setup.md](docs/01-local-setup.md) for full instructions.

```bash
# 1. Install k3s
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable=traefik" sh -

# 2. Deploy base infrastructure
kubectl apply -f manifests/base/

# 3. Apply database schema
bash scripts/apply-schema.sh
```

## Project Structure

```
coldchain/
├── config/                  # Service configuration files
│   └── mosquitto/           # Mosquitto MQTT broker config
├── docker-compose.yaml      # Alternative local dev (no k3s needed)
├── docs/                    # Setup guides and documentation
│   └── 01-local-setup.md   # k3s + WSL2 setup guide
├── manifests/               # Kubernetes manifests
│   ├── base/                # TimescaleDB, Mosquitto, Redis
│   ├── chirpstack/          # ChirpStack network server (TODO)
│   └── keycloak/            # Keycloak auth server (TODO)
├── scripts/                 # Utility scripts
│   ├── init-db.sql          # Application database schema
│   └── apply-schema.sh      # Schema deployment helper
└── services/                # Custom application code (TODO)
    ├── integration/         # FastAPI integration service
    ├── frontend/            # React frontend
    └── simulator/           # Sensor data simulator
```

## Development Roadmap

- [x] Base infrastructure (TimescaleDB, Mosquitto, Redis)
- [x] Database schema with TimescaleDB hypertables
- [ ] ChirpStack deployment
- [ ] Sensor data simulator
- [ ] Integration service (FastAPI)
- [ ] Keycloak setup
- [ ] React frontend
