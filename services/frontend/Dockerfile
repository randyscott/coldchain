# =============================================================================
# Multi-stage build: Node for building, Nginx for serving
# =============================================================================

# Stage 1: Build
FROM node:20-alpine AS build

# Build-time Keycloak config — baked into the JS bundle by Vite.
# Pass with: docker build --build-arg VITE_KEYCLOAK_URL=https://...
ARG VITE_KEYCLOAK_URL
ARG VITE_KEYCLOAK_REALM=coldchain
ARG VITE_KEYCLOAK_CLIENT_ID=coldchain-web
ENV VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL
ENV VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM
ENV VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Nginx config: SPA routing + API proxy
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
