# Frontend

React-based dashboard for the cold chain monitoring system. Provides
real-time visibility into sensor data, system health, and alerts.

## Views

- **Dashboard** — Overview of all systems with status cards showing
  temperature, sensor count, active alerts, and last update time.
- **System Detail** — Drill into a single system: sensor list with
  current readings, expandable temperature charts, active alert
  banners, and alert history table.
- **Alerts** — Cross-system list of all alert events with status,
  trigger values, and timestamps.

## Tech Stack

| Concern | Choice |
|---------|--------|
| Framework | React 18 + TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS (dark theme) |
| Charts | Recharts |
| Server state | TanStack Query (React Query) |
| Routing | React Router v6 |
| Icons | Lucide React |
| Fonts | DM Sans + JetBrains Mono |

## Quick Start (Local Development)

```bash
cd services/frontend
npm install
npm run dev
```

Opens at `http://localhost:5173`. Vite proxies `/api/*` requests to
`http://localhost:8000` (the integration service), so make sure that's
running too.

### Full local dev stack

Terminal 1 — port-forward infrastructure (if using k3s):
```bash
kubectl port-forward svc/timescaledb 5432:5432 -n coldchain &
kubectl port-forward svc/mosquitto 1883:1883 -n coldchain &
```

Terminal 2 — integration service:
```bash
cd services/integration
./run-dev.sh
```

Terminal 3 — simulator:
```bash
cd services/simulator
pip install -r requirements.txt
python simulator.py --interval 10
```

Terminal 4 — frontend:
```bash
cd services/frontend
npm run dev
```

Then open `http://localhost:5173` and you should see live data flowing
through the dashboard.

## Deploy to k3s

```bash
# 1. Build the container image
cd services/frontend
npm install
docker build -t coldchain/frontend:dev .

# 2. Import into k3s
docker save coldchain/frontend:dev | sudo k3s ctr images import -

# 3. Deploy
kubectl apply -f manifests/base/60-frontend.yaml

# 4. Wait for pod
kubectl wait --for=condition=Ready pod -l app=frontend -n coldchain --timeout=60s

# 5. Access the UI
kubectl port-forward svc/frontend 3000:80 -n coldchain &
```

Open `http://localhost:3000`. The Nginx container proxies API requests
to the integration service inside the cluster.

### Rebuild after changes

```bash
cd services/frontend
npm run build
docker build -t coldchain/frontend:dev .
docker save coldchain/frontend:dev | sudo k3s ctr images import -
kubectl rollout restart deploy/frontend -n coldchain
```

## Project Structure

```
services/frontend/
├── public/
│   └── favicon.svg
├── src/
│   ├── api/
│   │   └── client.ts          # Typed API client for all backend endpoints
│   ├── components/
│   │   ├── dashboard/
│   │   │   └── SystemCard.tsx  # System status card for the overview
│   │   ├── layout/
│   │   │   └── AppLayout.tsx   # App shell with navigation
│   │   └── system/
│   │       ├── SensorRow.tsx   # Expandable sensor row with chart
│   │       └── TemperatureChart.tsx  # Recharts time-series chart
│   ├── pages/
│   │   ├── AlertsPage.tsx
│   │   ├── DashboardPage.tsx
│   │   └── SystemDetailPage.tsx
│   ├── utils/
│   │   └── format.ts          # Formatting helpers (temp, humidity, etc.)
│   ├── index.css               # Tailwind + custom component classes
│   ├── main.tsx                # App entry point with routing + React Query
│   └── vite-env.d.ts
├── Dockerfile                  # Multi-stage: Node build + Nginx serve
├── nginx.conf                  # SPA routing + API proxy
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

## Design Decisions

**Dark theme** — Monitoring dashboards are often displayed on wall-mounted
screens or used in low-light environments. The dark navy color scheme
reduces eye strain and makes alert indicators more prominent.

**Auto-refresh** — TanStack Query refetches system summary every 15 seconds
and sensor readings every 30 seconds. The dashboard stays current without
manual refresh.

**Expandable sensor rows** — Readings are loaded on-demand when a sensor
row is expanded. This avoids loading hundreds of data points for every
sensor on page load.

**Threshold reference lines** — Alert rule thresholds are overlaid on
temperature charts as dashed red lines, making it immediately visible
when readings approach or breach limits.
