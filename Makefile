.PHONY: build build-web sidecar desktop desktop-dev test test-go test-web vet lint format check clean run dev

APP_NAME := agentui-daemon

# web/node_modules sits inside the module tree and ships vendored Go files, so
# ./... would pick them up. Filter them out everywhere.
GO_PACKAGES := $(shell go list ./... 2>/dev/null | grep -v /node_modules/)
GO_FILES := $(shell git ls-files '*.go' 2>/dev/null || find . -name '*.go' -not -path './web/node_modules/*')

build:
	go build -o $(APP_NAME) .

build-web:
	cd web && npm run build

# Compiles the daemon into web/src-tauri/binaries with the target-triple suffix
# Tauri expects for sidecars.
sidecar:
	./scripts/build-sidecar.sh

# Desktop app with the daemon bundled inside it.
desktop: sidecar
	cd web && npm run desktop:build

desktop-dev: sidecar
	cd web && npm run desktop:dev

test: test-go test-web

test-go:
	go test -count=1 -cover -race $(GO_PACKAGES)

test-web:
	cd web && npm test

vet:
	go vet $(GO_PACKAGES)

fmt-check:
	@unformatted=$$(gofmt -l $(GO_FILES)); \
	if [ -n "$$unformatted" ]; then echo "These files need gofmt:"; echo "$$unformatted"; exit 1; fi

lint:
	cd web && npm run lint

format:
	gofmt -w $(GO_FILES)
	cd web && npm run format

# Everything CI runs, in one command.
check: fmt-check vet test-go lint test-web

clean:
	rm -f $(APP_NAME)
	rm -rf web/src-tauri/binaries web/src-tauri/target

run: build
	./$(APP_NAME)

dev:
	@echo "Starting daemon + frontend dev server..."
	@trap 'kill 0' EXIT; \
	./$(APP_NAME) & \
	cd web && npm run dev -- --host & \
	wait
