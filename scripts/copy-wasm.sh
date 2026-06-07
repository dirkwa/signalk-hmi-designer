#!/usr/bin/env bash
# Copy the LVGL-WASM bundle from the sister sensesp-p4-cockpit-wasm
# repo into the designer's webapp/public/wasm/ so Vite serves it
# alongside the rest of the bundle.
#
# Run before `vite build` (wired into npm script `prebuild:webapp`).
# Doesn't fail the build if the wasm repo isn't present locally —
# the WASM preview mode just won't load (404).

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DEFAULT="${REPO_ROOT}/../sensesp-p4-cockpit-wasm/public"
SRC="${JLP_WASM_DIR:-$SRC_DEFAULT}"
DEST="${REPO_ROOT}/webapp/public/wasm"

if [[ ! -f "${SRC}/jlp_wasm.js" || ! -f "${SRC}/jlp_wasm.wasm" ]]; then
  echo "[copy-wasm] no wasm bundle at ${SRC} — WASM preview will be unavailable" >&2
  echo "[copy-wasm] (build sensesp-p4-cockpit-wasm to enable it)" >&2
  exit 0
fi

mkdir -p "${DEST}"
cp -f "${SRC}/jlp_wasm.js"   "${DEST}/jlp_wasm.js"
cp -f "${SRC}/jlp_wasm.wasm" "${DEST}/jlp_wasm.wasm"
echo "[copy-wasm] copied $(du -h "${DEST}/jlp_wasm.wasm" | cut -f1) wasm + glue to ${DEST}"
