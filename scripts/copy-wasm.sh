#!/usr/bin/env bash
# Stage the LVGL-WASM bundle into the designer's webapp/public/wasm/ so
# Vite serves it alongside the rest of the bundle. Run before
# `vite build` (wired into the build:webapp npm script).
#
# Source resolution, in order:
#   1. JLP_WASM_DIR (explicit local override)
#   2. ../espos-p4-cockpit-wasm/public (sibling checkout, local dev)
#   3. raw.githubusercontent of the wasm repo's main branch (CI, where
#      the sibling repo isn't checked out — without this the published
#      package ships no wasm and the designer's WASM canvas 404s).
#
# Still doesn't fail the build if the bundle can't be obtained at all —
# the WASM preview just won't load — but the curl fallback means a
# normal CI publish gets it.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DEFAULT="${REPO_ROOT}/../espos-p4-cockpit-wasm/public"
SRC="${JLP_WASM_DIR:-$SRC_DEFAULT}"
DEST="${REPO_ROOT}/webapp/public/wasm"
RAW_BASE="${JLP_WASM_URL:-https://raw.githubusercontent.com/dirkwa/espos-p4-cockpit-wasm/main/public}"

mkdir -p "${DEST}"

if [[ -f "${SRC}/jlp_wasm.js" && -f "${SRC}/jlp_wasm.wasm" ]]; then
  cp -f "${SRC}/jlp_wasm.js"   "${DEST}/jlp_wasm.js"
  cp -f "${SRC}/jlp_wasm.wasm" "${DEST}/jlp_wasm.wasm"
  echo "[copy-wasm] copied wasm + glue from ${SRC}"
  exit 0
fi

echo "[copy-wasm] no local bundle at ${SRC}; fetching from ${RAW_BASE}" >&2
if curl -fsSL "${RAW_BASE}/jlp_wasm.js"   -o "${DEST}/jlp_wasm.js" && \
   curl -fsSL "${RAW_BASE}/jlp_wasm.wasm" -o "${DEST}/jlp_wasm.wasm"; then
  echo "[copy-wasm] fetched $(du -h "${DEST}/jlp_wasm.wasm" | cut -f1) wasm + glue"
  exit 0
fi

# Clean up any partial download so a broken bundle isn't served.
rm -f "${DEST}/jlp_wasm.js" "${DEST}/jlp_wasm.wasm"
echo "[copy-wasm] could not obtain wasm bundle — WASM preview will be unavailable" >&2
echo "[copy-wasm] (build espos-p4-cockpit-wasm or check ${RAW_BASE})" >&2
# Fail loudly in CI / release so a package can't be published without the
# wasm (the exact "blank WASM canvas" regression this fallback prevents).
# Local dev stays soft so a missing bundle doesn't block a normal build.
# Match common truthy CI values (GitHub sets CI=true; others use 1/yes/on),
# case-insensitively, so a non-"true" runner can't slip through.
ci_flag="$(printf '%s' "${CI:-}" | tr '[:upper:]' '[:lower:]')"
case "${ci_flag}" in
  true | 1 | yes | on) ci_required=1 ;;
  *) ci_required=0 ;;
esac
if [[ "${ci_required}" == "1" || "${REQUIRE_WASM:-0}" == "1" ]]; then
  echo "[copy-wasm] wasm is required in CI/release mode — failing build" >&2
  exit 1
fi
exit 0
