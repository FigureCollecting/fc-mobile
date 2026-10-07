# syntax=docker/dockerfile:1
# fc-mobile-web: the production build on nginx-unprivileged.
#   docker build --secret id=node_auth_token,env=NODE_AUTH_TOKEN -t fc-mobile-web .
# Runs as uid 101 on :8080 with a read-only root; mount a writable /tmp
# (pid file, temp paths, and the HOLDING switch). Base images are pinned by digest; the runtime
# stage takes Alpine's package fixes at build time (apk upgrade).

FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# The token only exists for this RUN; it never lands in a layer.
RUN --mount=type=secret,id=node_auth_token \
    NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token)" npm ci --ignore-scripts
COPY . .
ARG VITE_BUILD_ID=dev
ENV VITE_BUILD_ID=${VITE_BUILD_ID}
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.30.5-alpine3.24-slim@sha256:e28dcf0a161ddcbf228c7364b4a14f9bad4763ae8f5317c437b896afa3df4b84 AS web
ARG VITE_BUILD_ID=dev
LABEL org.opencontainers.image.title="fc-mobile-web" \
      org.opencontainers.image.description="FigureCollecting PWA: static build on nginx-unprivileged" \
      org.opencontainers.image.source="https://github.com/FigureCollecting/fc-mobile" \
      org.opencontainers.image.version="${VITE_BUILD_ID}"
# Alpine's security fixes that the pinned base predates (pcre2 10.49-r0 for
# CVE-2026-103111): the base image runs as 101, apk needs root.
USER root
RUN apk upgrade --no-cache
# Root-owned and read-only to the nginx user: the server can serve, not modify.
COPY --chown=root:root --chmod=0644 deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=root:root /app/dist /usr/share/nginx/html
# R-1(b): HOLDING=1 serves the holding page instead of the app (deploy/nginx/40-fc-holding.sh).
COPY --chown=root:root --chmod=0644 deploy/nginx/holding.html /usr/share/nginx/html/holding.html
COPY --chown=root:root --chmod=0755 deploy/nginx/40-fc-holding.sh /docker-entrypoint.d/40-fc-holding.sh
ENV HOLDING=0
USER 101
EXPOSE 8080
