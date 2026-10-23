# syntax=docker/dockerfile:1
ARG NODE_VERSION=22-alpine
ARG GO_VERSION=1.26-alpine
ARG DISTROLESS_VERSION=nonroot
ARG NGINX_VERSION=1.28-alpine
ARG CC_UI_TAG=0.4.0

###
# web stage
###
FROM node:${NODE_VERSION} AS web

WORKDIR /web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
# Release tag shown in the sidebar; CI passes it, a local build shows "dev".
ARG VERSION=dev
RUN VITE_VERSION="${VERSION}" npm run build

###
# build stage
###
FROM golang:${GO_VERSION} AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=web /web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

###
# legacy (local build only: LinkedIn UI served by nginx, no CI builds or publishes it)
###
FROM nginx:${NGINX_VERSION} AS legacy

ARG CC_UI_TAG
ARG UI_UID=101
ARG UI_GID=101

LABEL maintainer="Iván Alejandro Marugán <hello@ialejandro.rocks>" \
      org.opencontainers.image.title="Cruise Control UI" \
      org.opencontainers.image.description="Cruise Control UI with Nginx" \
      org.opencontainers.image.version="${CC_UI_TAG}"

# The release tarball holds cruise-control-ui/dist; keep only dist.
# Non-root nginx needs a writable cache dir and a pid file outside /run.
RUN wget -qO- "https://github.com/linkedin/cruise-control-ui/releases/download/v${CC_UI_TAG}/cruise-control-ui-${CC_UI_TAG}.tar.gz" \
      | tar xz -C /usr/share/nginx/html --strip-components=2 cruise-control-ui/dist && \
    mkdir -p /usr/share/nginx/html/static && \
    printf "local,local,/kafkacruisecontrol/\n" > /usr/share/nginx/html/static/config.csv && \
    chown -R ${UI_UID}:${UI_GID} /usr/share/nginx/html /var/cache/nginx && \
    sed -i 's#/run/nginx.pid#/tmp/nginx.pid#' /etc/nginx/nginx.conf

USER ${UI_UID}

CMD ["nginx", "-g", "daemon off;"]

###
# kafka-cruise-control-ui
###
FROM gcr.io/distroless/static-debian12:${DISTROLESS_VERSION} AS kafka-cruise-control-ui

ARG UI_UID=65532
ARG UI_GID=65532

LABEL maintainer="Iván Alejandro Marugán <hello@ialejandro.rocks>" \
      org.opencontainers.image.title="Kafka Cruise Control UI" \
      org.opencontainers.image.description="Web UI and authenticated proxy for Kafka Cruise Control" \
      org.opencontainers.image.source="https://github.com/devops-ia/kafka-cruise-control-ui"

COPY --from=build --chown=${UI_UID}:${UI_GID} /out/server /server

USER ${UI_UID}:${UI_GID}

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD ["/server", "-healthcheck"]

ENTRYPOINT ["/server"]
