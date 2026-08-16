#!/usr/bin/env bash
#
# Builds the Go daemon as a Tauri sidecar.
#
# Tauri resolves sidecars by appending the Rust target triple to the configured
# name, so the binary must be written as `agentui-daemon-<triple>` (plus `.exe`
# on Windows). Without the suffix the bundler reports the sidecar as missing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/web/src-tauri/binaries"

# The triple Rust will build for; honours an explicit override for cross builds.
TRIPLE="${TAURI_TARGET_TRIPLE:-$(rustc -vV | awk '/^host:/ {print $2}')}"

# Map the Rust triple onto Go's GOOS/GOARCH.
case "$TRIPLE" in
  x86_64-apple-darwin)          GOOS=darwin  GOARCH=amd64 ;;
  aarch64-apple-darwin)         GOOS=darwin  GOARCH=arm64 ;;
  x86_64-unknown-linux-gnu)     GOOS=linux   GOARCH=amd64 ;;
  aarch64-unknown-linux-gnu)    GOOS=linux   GOARCH=arm64 ;;
  x86_64-pc-windows-msvc)       GOOS=windows GOARCH=amd64 ;;
  aarch64-pc-windows-msvc)      GOOS=windows GOARCH=arm64 ;;
  *)
    echo "build-sidecar: unsupported target triple '$TRIPLE'" >&2
    echo "Add a GOOS/GOARCH mapping for it in scripts/build-sidecar.sh." >&2
    exit 1
    ;;
esac

EXT=""
[ "$GOOS" = "windows" ] && EXT=".exe"

mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/agentui-daemon-$TRIPLE$EXT"

echo "building sidecar for $TRIPLE (GOOS=$GOOS GOARCH=$GOARCH)"
cd "$ROOT"
CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" \
  go build -trimpath -ldflags="-s -w" -o "$OUT" .

echo "wrote $OUT"
