# Cold Chain Monitoring System — Local Development Setup

## Prerequisites

- Windows 10/11 with WSL2 enabled
- Ubuntu 22.04 or 24.04 under WSL2
- 16 GB RAM minimum (32 GB recommended)
- Docker Desktop is **not required** — k3s uses containerd directly

---

## Step 1: Prepare WSL2

### 1a. Enable Mirrored Networking

WSL2 defaults to NAT networking, which makes it difficult for physical LoRaWAN
gateways on your LAN to reach services inside WSL2. Mirrored networking gives
WSL2 the same IP as your Windows host, solving this.

**Requires:** Windows 11 22H2+ with a recent WSL2 version.

On the **Windows side**, create or edit `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
```

Then restart WSL from an **elevated PowerShell**:

```powershell
wsl --shutdown
```

Re-open your Ubuntu terminal.

### 1b. Install Packages and Enable systemd

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y curl wget git jq openssl

# Install MQTT client tools (broker package NOT needed — only the clients)
sudo apt install -y mosquitto-clients

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

### 1c. Verify Mirrored Networking

```bash
ip addr show eth0
```

With mirrored networking, this should show your LAN IP (e.g., `192.168.1.x`)
rather than a `172.x.x.x` NAT address. If you still see a 172.x address,
check that `.wslconfig` is in the right location and that you restarted WSL.

> **Note:** If mirrored networking is not available on your Windows build,
> see the "NAT Networking Fallback" section at the bottom of this document.

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

## Step 8: Connect Physical LoRaWAN Gateways

The ChirpStack Gateway Bridge is exposed as a NodePort service on UDP port
**31700**. With mirrored networking, your WSL2 instance shares your Windows
host's LAN IP, so gateways on the same network can reach it directly.

### 8a. Open the Windows Firewall

In an **elevated PowerShell**:

```powershell
New-NetFirewallRule `
  -DisplayName "LoRaWAN Gateway Bridge (UDP 31700)" `
  -Direction Inbound `
  -Protocol UDP `
  -LocalPort 31700 `
  -Action Allow
```

### 8b. Find Your LAN IP

```bash
# From WSL2:
ip addr show eth0 | grep 'inet '
# e.g., inet 192.168.1.50/24
```

Or from PowerShell: `ipconfig` and look for your primary adapter's IPv4 address.

### 8c. Configure the Gateway

On your Ezurio RG1xx (or any Semtech Packet Forwarder-based gateway), update
the packet forwarder configuration:

- **Server address:** your LAN IP (e.g., `192.168.1.50`)
- **Server port (up):** `31700`
- **Server port (down):** `31700`

For the RG1xx, this is typically in the web UI under
**LoRa > Forwarder > Network Server Settings**.

### 8d. Verify Gateway Connectivity

```bash
# Watch the gateway bridge logs for incoming packets:
kubectl logs -f deploy/chirpstack-gateway-bridge -n coldchain

# You should see lines like:
# gateway: received uplink frame  gateway_id=<your-gateway-eui>
```

You can also check the ChirpStack web UI at http://localhost:8080 — after
port-forwarding (`kubectl port-forward svc/chirpstack 8080:8080 -n coldchain &`),
registered gateways will show a "Last seen" timestamp once packets arrive.

### 8e. Troubleshooting

If no packets appear:

1. **Verify firewall:** `Test-NetConnection -ComputerName localhost -Port 31700`
   from PowerShell (note: this tests TCP, but confirms the port isn't blocked).
   For UDP, use `nmap -sU -p 31700 localhost` if available.

2. **Verify NodePort is active:**
   ```bash
   kubectl get svc chirpstack-gateway-bridge -n coldchain
   # Should show: 1700:31700/UDP
   ```

3. **Test from another machine on the LAN:**
   ```bash
   # From another Linux box, send a test UDP packet:
   echo "test" | nc -u <your-lan-ip> 31700
   ```
   Check gateway bridge logs for any received data.

4. **Check gateway logs** on the RG1xx web UI for send errors or DNS failures.

5. **Mirrored networking not working?** Verify `.wslconfig` is at
   `%USERPROFILE%\.wslconfig` (not inside WSL). Run `wsl --shutdown` and
   reopen. Check `ip addr show eth0` — you need a LAN IP, not 172.x.

---

## NAT Networking Fallback

If mirrored networking is unavailable (older Windows 10 builds), WSL2 uses NAT
with a private 172.x address. UDP port forwarding from Windows to WSL2 is not
natively supported by `netsh portproxy` (TCP only).

**Workaround options:**

1. **Run the gateway bridge outside k3s** as a standalone Docker container
   with host networking:
   ```bash
   docker run -d --name gateway-bridge \
     --network host \
     -e INTEGRATION__MQTT__AUTH__GENERIC__SERVER="tcp://localhost:1883" \
     -e INTEGRATION__MQTT__AUTH__GENERIC__USERNAME="chirpstack" \
     -e INTEGRATION__MQTT__AUTH__GENERIC__PASSWORD="chirpstack_mqtt_dev" \
     chirpstack/chirpstack-gateway-bridge:4
   ```
   This binds UDP 1700 directly. You'll need Mosquitto port-forwarded to
   localhost:1883 for this to reach the k3s MQTT broker.

2. **Use `socat` on Windows** (via Cygwin or MSYS2) to bridge UDP from
   the Windows interface to the WSL2 NAT address.

3. **Upgrade to Windows 11** to get mirrored networking support.

---

## Next Steps

1. Deploy ChirpStack (see `manifests/chirpstack/` and `docs/02-chirpstack-simulator.md`)
2. Initialize the database schema (see `scripts/init-db.sql`)
3. Run the sensor simulator (see `docs/02-chirpstack-simulator.md`)
4. Deploy the integration service
5. Deploy Keycloak
6. Deploy the React frontend
