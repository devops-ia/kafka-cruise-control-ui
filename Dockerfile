# syntax=docker/dockerfile:1
ARG NODE_VERSION=22-alpine
ARG GO_VERSION=1.26-alpine
ARG DISTROLESS_VERSION=nonroot

###
# web stage
###
FROM node:${NODE_VERSION} AS web

WORKDIR /web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

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
