# Cold Chain Monitoring System — Local Development Setup

## Prerequisites

- Windows 10/11 with WSL2 enabled
- Ubuntu 22.04 or 24.04 under WSL2
- 16 GB RAM minimum (32 GB recommended)
- Docker Desktop is **not required** — k3s uses containerd directly

---

## Step 1: Prepare WSL2

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y curl wget git jq openssl

# Verify systemd is enabled (required for k3s)
# WSL2 on recent Windows builds supports systemd natively
cat /etc/wsl.conf
# Should contain:
# [boot]
# systemd=true
#
# If not, add it:
sudo tee /etc/wsl.conf > /dev/null <<EOF
[boot]
systemd=true
EOF
# Then restart WSL from PowerShell: wsl --shutdown
# Re-open your Ubuntu terminal after restart
```

## Step 2: Install k3s

```bash
# Install k3s (single-node, with Traefik ingress disabled — we'll use our own)
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable=traefik" sh -

# Wait for k3s to be ready
sudo k3s kubectl wait --for=condition=Ready node --all --timeout=120s

# Set up kubectl access for your user (non-root)
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
export KUBECONFIG=~/.kube/config

# Add to .bashrc so it persists
echo 'export KUBECONFIG=~/.kube/config' >> ~/.bashrc

# Install kubectl alias (optional but recommended)
echo 'alias k=kubectl' >> ~/.bashrc
source ~/.bashrc

# Verify
kubectl get nodes
# Should show one node in Ready state
```

## Step 3: Install Helm

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Verify
helm version
```

## Step 4: Create the coldchain namespace

```bash
kubectl create namespace coldchain
kubectl config set-context --current --namespace=coldchain
```

## Step 5: Deploy base infrastructure

The manifests in `manifests/base/` deploy TimescaleDB, Mosquitto, and Redis.

```bash
# From the project root directory:
kubectl apply -f manifests/base/

# Wait for all pods to be ready
kubectl wait --for=condition=Ready pod --all -n coldchain --timeout=300s

# Verify everything is running
kubectl get pods -n coldchain
```

Expected output:
```
NAME                          READY   STATUS    RESTARTS   AGE
timescaledb-0                 1/1     Running   0          60s
mosquitto-xxxxxxxxxx-xxxxx    1/1     Running   0          60s
redis-xxxxxxxxxx-xxxxx        1/1     Running   0          60s
```

## Step 6: Verify services

```bash
# Test TimescaleDB connection
kubectl exec -it timescaledb-0 -n coldchain -- psql -U coldchain -d coldchain -c "SELECT version();"

# Test Mosquitto
# (install mosquitto-clients if needed: sudo apt install -y mosquitto-clients)
# Port-forward Mosquitto to localhost:
kubectl port-forward svc/mosquitto 1883:1883 -n coldchain &

# In another terminal, subscribe to all topics:
mosquitto_sub -h localhost -p 1883 -t '#' -u coldchain -P coldchain_dev &

# Publish a test message:
mosquitto_pub -h localhost -p 1883 -t 'test/hello' -m 'it works' -u coldchain -P coldchain_dev

# You should see "it works" appear in the subscriber terminal

# Test Redis
kubectl exec -it deploy/redis -n coldchain -- redis-cli ping
# Should return: PONG
```

## Step 7: Access services from your host

For development, use `kubectl port-forward` to expose services:

```bash
# TimescaleDB (PostgreSQL) on localhost:5432
kubectl port-forward svc/timescaledb 5432:5432 -n coldchain &

# Mosquitto MQTT on localhost:1883
kubectl port-forward svc/mosquitto 1883:1883 -n coldchain &

# Redis on localhost:6379
kubectl port-forward svc/redis 6379:6379 -n coldchain &
```

You can then connect with standard tools (psql, pgAdmin, MQTT Explorer, etc.)
from your Windows host via `localhost`.

---

## Next Steps

1. Deploy ChirpStack (see `manifests/chirpstack/`)
2. Initialize the database schema (see `scripts/init-db.sql`)
3. Run the sensor simulator (see `scripts/simulator.py`)
4. Deploy the integration service
5. Deploy Keycloak
6. Deploy the React frontend
