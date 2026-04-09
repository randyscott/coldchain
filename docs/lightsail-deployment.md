# AWS Lightsail Deployment Guide

This document covers the steps to deploy the coldchain stack to a single AWS Lightsail instance running k3s, with TLS via Let's Encrypt.

## Prerequisites

- AWS Lightsail instance (recommend 2 GB RAM minimum — Keycloak alone needs ~512 MB)
- A domain name with DNS pointing to the instance's static IP
- k3s installed on the instance
- Docker installed on the instance (for building images)

---

## 1. DNS & Domain Setup

Point the following subdomains (or paths on a single domain) to your Lightsail static IP:

```
coldchain.yourdomain.com        → frontend
coldchain.yourdomain.com/api    → integration service (proxied by frontend nginx)
coldchain.yourdomain.com/auth   → Keycloak
```

Using a single domain with path-based routing is simplest on a single instance.

---

## 2. Install cert-manager for TLS

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
```

Create a ClusterIssuer for Let's Encrypt:

```yaml
# manifests/base/00-cert-issuer.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@yourdomain.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: traefik   # k3s uses Traefik ingress by default
```

---

## 3. Create a k3s Ingress with TLS

k3s ships with Traefik as the ingress controller. Create an Ingress that routes all traffic
and terminates TLS:

```yaml
# manifests/base/70-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: coldchain-ingress
  namespace: coldchain
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    traefik.ingress.kubernetes.io/router.middlewares: coldchain-strip-auth-prefix@kubernetescrd
spec:
  tls:
    - hosts:
        - coldchain.yourdomain.com
      secretName: coldchain-tls
  rules:
    - host: coldchain.yourdomain.com
      http:
        paths:
          - path: /auth
            pathType: Prefix
            backend:
              service:
                name: keycloak
                port:
                  number: 8081
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
```

Note: The frontend's nginx.conf already proxies `/api/*` to the integration service internally,
so only two backend entries are needed in the Ingress.

---

## 4. Switch Keycloak from start-dev to start

Update the args in `manifests/keycloak/10-keycloak.yaml`:

```yaml
args:
  - "start"
  - "--import-realm"
  - "--http-enabled=true"           # Keycloak speaks HTTP; TLS is terminated at the ingress
  - "--hostname=coldchain.yourdomain.com"
  - "--hostname-strict=false"       # Allows internal cluster traffic without hostname match
```

---

## 5. Update Keycloak realm for the production domain

In `config/keycloak/coldchain-realm.json`, update the `coldchain-web` client's redirect URIs
and web origins:

```json
"redirectUris": [
  "https://coldchain.yourdomain.com/*"
],
"webOrigins": [
  "https://coldchain.yourdomain.com"
]
```

Regenerate the ConfigMap after editing the JSON:

```bash
kubectl create configmap keycloak-realm \
  --from-file=coldchain-realm.json=config/keycloak/coldchain-realm.json \
  -n coldchain --dry-run=client -o yaml > manifests/keycloak/00-realm-configmap.yaml
```

---

## 6. Update the integration service Keycloak URLs

In `manifests/base/50-integration.yaml`, both URLs should point to the public domain since
there's no internal/external split needed when Keycloak is behind the same ingress:

```yaml
COLDCHAIN_KEYCLOAK_URL: "https://coldchain.yourdomain.com/auth"
COLDCHAIN_KEYCLOAK_REALM: "coldchain"
COLDCHAIN_KEYCLOAK_CLIENT_ID: "coldchain-api"
# No COLDCHAIN_KEYCLOAK_PUBLIC_URL needed — internal and external URLs are the same
```

---

## 7. Update the frontend build

The frontend Keycloak URL is baked in at build time via Vite env vars. Set these when
building the production image:

```bash
VITE_KEYCLOAK_URL=https://coldchain.yourdomain.com/auth \
VITE_KEYCLOAK_REALM=coldchain \
VITE_KEYCLOAK_CLIENT_ID=coldchain-web \
docker build -t coldchain/frontend:prod services/frontend/
```

Or add a `.env.production` file to `services/frontend/`:

```
VITE_KEYCLOAK_URL=https://coldchain.yourdomain.com/auth
VITE_KEYCLOAK_REALM=coldchain
VITE_KEYCLOAK_CLIENT_ID=coldchain-web
```

---

## 8. Harden credentials before deploying

Replace all dev-placeholder passwords before applying to production:

- `manifests/base/01-secrets.yaml` — database, MQTT, Redis passwords
- `manifests/keycloak/10-keycloak.yaml` — `KEYCLOAK_ADMIN_PASSWORD`, `KC_DB_PASSWORD`
- `config/keycloak/coldchain-realm.json` — demo user passwords (`admin123`, `viewer123`)

Consider using [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) or AWS
Secrets Manager (via External Secrets Operator) instead of plaintext k8s Secrets.

---

## 9. Open Lightsail firewall ports

In the Lightsail console, ensure the instance firewall allows:

| Port | Protocol | Purpose                    |
|------|----------|----------------------------|
| 80   | TCP      | HTTP (redirects to HTTPS)  |
| 443  | TCP      | HTTPS                      |
| 1700 | UDP      | LoRaWAN gateway bridge     |

The k3s API (6443) should remain closed to the public.

---

## 10. Build and push images

Since Lightsail won't have a registry, the simplest approach is to build images directly
on the instance:

```bash
# On the Lightsail instance
git clone <repo>
docker build -t coldchain/integration:prod services/integration/
docker build -t coldchain/frontend:prod services/frontend/   # with VITE_ env vars set

# Import into k3s containerd
docker save coldchain/integration:prod | sudo k3s ctr images import -
docker save coldchain/frontend:prod    | sudo k3s ctr images import -
```

Then update the image tags in the deployment manifests from `:dev` to `:prod`.
