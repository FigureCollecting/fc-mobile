# syntax=docker/dockerfile:1
# fc-mobile-web: the production build on nginx-unprivileged.
#   docker build --secret id=node_auth_token,env=NODE_AUTH_TOKEN -t fc-mobile-web .
# Runs as uid 101 on :8080 with a read-only root; mount a writable /tmp
# (pid file and temp paths). Base images are pinned by digest.

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

FROM nginxinc/nginx-unprivileged:1.30.5-alpine3.24-slim@sha256:307ca0bded4dda86dade6f5bd2a2551601bec9bac3fd73a21613fabcd9eca66a AS web
ARG VITE_BUILD_ID=dev
LABEL org.opencontainers.image.title="fc-mobile-web" \
      org.opencontainers.image.description="FigureCollecting PWA: static build on nginx-unprivileged" \
      org.opencontainers.image.source="https://github.com/FigureCollecting/fc-mobile" \
      org.opencontainers.image.version="${VITE_BUILD_ID}"
# Root-owned and read-only to the nginx user: the server can serve, not modify.
COPY --chown=root:root --chmod=0644 deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=root:root /app/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
