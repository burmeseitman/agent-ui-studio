# Stage 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Build the Go daemon
# Must match the toolchain in go.mod.
FROM golang:1.26-alpine AS backend-builder
WORKDIR /app
COPY go.mod ./
COPY *.go ./
COPY engine/ ./engine/
COPY adapter/ ./adapter/
COPY tools/ ./tools/
COPY api/ ./api/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o agentui-daemon .

# Stage 3: Runtime
FROM alpine:3.19
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 agentui

WORKDIR /app
COPY --from=backend-builder /app/agentui-daemon .
COPY --from=frontend-builder /app/web/dist ./web/dist

# The daemon's tools are sandboxed to its working directory; mount the project
# you want the agent to inspect at /workspace.
RUN mkdir -p /workspace && chown -R agentui:agentui /app /workspace
USER agentui

EXPOSE 8080
ENV OLLAMA_URL=http://host.docker.internal:11434 \
    LMSTUDIO_URL=http://host.docker.internal:1234

# The frontend is served from the same origin as the API, so no CORS setup is
# needed for the containerised deployment.
CMD ["./agentui-daemon", "-static-dir", "/app/web/dist", "-workspace", "/workspace"]
