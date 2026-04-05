#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/python-backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_ENV_FILE="$BACKEND_DIR/.env"

BACKEND_PORT="${BACKEND_PORT:-8001}"
FRONTEND_PORT="${FRONTEND_PORT:-4174}"
KEEP_SERVICES=0
ALLOW_BACKEND_ERRORS=0
SKIP_PLAYWRIGHT_INSTALL="${SKIP_PLAYWRIGHT_INSTALL:-0}"
BACKEND_LOGIN="${BACKEND_LOGIN:-}"
BACKEND_PASSWORD="${BACKEND_PASSWORD:-}"

usage() {
  cat <<'EOF'
Usage: ./test-suite.sh [options]

Options:
  --keep-services         Do not stop backend/frontend after test run
  --allow-backend-errors  Do not fail backend matrix when a case ends with status=error
  -h, --help              Show this help

Env overrides:
  BACKEND_PORT=8001
  FRONTEND_PORT=4174
  SKIP_PLAYWRIGHT_INSTALL=1
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-services)
      KEEP_SERVICES=1
      ;;
    --allow-backend-errors)
      ALLOW_BACKEND_ERRORS=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
  shift
done

for cmd in curl python3 node npm ss; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
done

RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="$ROOT_DIR/.tmp/test-logs/$RUN_ID"
mkdir -p "$LOG_DIR"

echo "[INFO] Logs: $LOG_DIR"

BACKEND_STARTED=0
FRONTEND_STARTED=0
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  if [[ "$KEEP_SERVICES" -eq 1 ]]; then
    return
  fi

  if [[ "$FRONTEND_STARTED" -eq 1 && -n "$FRONTEND_PID" ]]; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi

  if [[ "$BACKEND_STARTED" -eq 1 && -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

is_port_busy() {
  local port="$1"
  ss -ltn "sport = :$port" | awk 'NR>1{found=1} END{exit found?0:1}'
}

pick_free_port() {
  local port="$1"
  while is_port_busy "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

wait_http() {
  local url="$1"
  local timeout="${2:-60}"
  local i
  for ((i=0; i<timeout; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

BACKEND_PORT="$(pick_free_port "$BACKEND_PORT")"
FRONTEND_PORT="$(pick_free_port "$FRONTEND_PORT")"

if [[ -z "$BACKEND_LOGIN" ]]; then
  BACKEND_LOGIN="$(awk -F= '/^ADMIN_USER=/{print $2}' "$BACKEND_ENV_FILE" | tail -n1 | tr -d "\"'[:space:]")"
fi
if [[ -z "$BACKEND_PASSWORD" ]]; then
  BACKEND_PASSWORD="$(awk -F= '/^ADMIN_PASSWORD=/{print $2}' "$BACKEND_ENV_FILE" | tail -n1 | tr -d "\"'[:space:]")"
fi
if [[ -z "$BACKEND_LOGIN" ]]; then
  BACKEND_LOGIN="admin"
fi
if [[ -z "$BACKEND_PASSWORD" ]]; then
  BACKEND_PASSWORD="Fastmp3fast123!"
fi

echo "[INFO] Backend port:  $BACKEND_PORT"
echo "[INFO] Frontend port: $FRONTEND_PORT"
echo "[INFO] Backend login: $BACKEND_LOGIN"

if [[ ! -d "$BACKEND_DIR/.venv" ]]; then
  echo "[ERROR] Backend virtualenv not found at $BACKEND_DIR/.venv"
  echo "        Run: cd $BACKEND_DIR && ./bootstrap.sh"
  exit 1
fi

echo "[INFO] Starting backend..."
(
  cd "$BACKEND_DIR"
  . .venv/bin/activate
  export PYTHONPATH="$BACKEND_DIR"
  python -m uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT"
) >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
BACKEND_STARTED=1

if ! wait_http "http://127.0.0.1:${BACKEND_PORT}/up" 60; then
  echo "[ERROR] Backend did not become ready. See $LOG_DIR/backend.log"
  exit 1
fi

echo "[INFO] Running backend matrix test..."
BACKEND_MATRIX_CMD=(
  python3 "$ROOT_DIR/scripts/backend_matrix_test.py"
  --base-url "http://127.0.0.1:${BACKEND_PORT}/api/v1"
  --login "$BACKEND_LOGIN"
  --password "$BACKEND_PASSWORD"
)
if [[ "$ALLOW_BACKEND_ERRORS" -eq 1 ]]; then
  BACKEND_MATRIX_CMD+=(--allow-errors)
fi

set +e
"${BACKEND_MATRIX_CMD[@]}" | tee "$LOG_DIR/backend-matrix.json"
BACKEND_RC=${PIPESTATUS[0]}
set -e

if [[ "$BACKEND_RC" -ne 0 ]]; then
  echo "[ERROR] Backend matrix failed"
else
  echo "[OK] Backend matrix passed"
fi

if [[ "$SKIP_PLAYWRIGHT_INSTALL" != "1" ]]; then
  echo "[INFO] Ensuring Playwright chromium is installed..."
  (
    cd "$FRONTEND_DIR"
    npx playwright install chromium
  ) >"$LOG_DIR/playwright-install.log" 2>&1
fi

echo "[INFO] Building frontend with API base..."
(
  cd "$FRONTEND_DIR"
  VITE_API_BASE_URL="http://127.0.0.1:${BACKEND_PORT}/api/v1" npm run build
) >"$LOG_DIR/frontend-build.log" 2>&1

echo "[INFO] Starting frontend preview..."
(
  cd "$FRONTEND_DIR"
  npm run preview -- --host 127.0.0.1 --port "$FRONTEND_PORT"
) >"$LOG_DIR/frontend-preview.log" 2>&1 &
FRONTEND_PID=$!
FRONTEND_STARTED=1

if ! wait_http "http://127.0.0.1:${FRONTEND_PORT}/fastmp3fast/" 60; then
  echo "[ERROR] Frontend preview did not become ready. See $LOG_DIR/frontend-preview.log"
  exit 1
fi

echo "[INFO] Running frontend offline E2E..."
set +e
(
  cd "$FRONTEND_DIR"
  E2E_BASE_URL="http://127.0.0.1:${FRONTEND_PORT}" \
  E2E_APP_PREFIX="/fastmp3fast" \
  E2E_LOGIN="$BACKEND_LOGIN" \
  E2E_PASSWORD="$BACKEND_PASSWORD" \
  node e2e-offline.mjs
) | tee "$LOG_DIR/frontend-e2e.json"
FRONTEND_RC=${PIPESTATUS[0]}
set -e

if [[ "$FRONTEND_RC" -ne 0 ]]; then
  echo "[ERROR] Frontend E2E failed"
else
  echo "[OK] Frontend E2E passed"
fi

echo
echo "[SUMMARY]"
echo "  Backend matrix: $([[ $BACKEND_RC -eq 0 ]] && echo PASS || echo FAIL)"
echo "  Frontend E2E:  $([[ $FRONTEND_RC -eq 0 ]] && echo PASS || echo FAIL)"
echo "  Logs dir:      $LOG_DIR"

if [[ "$BACKEND_RC" -ne 0 || "$FRONTEND_RC" -ne 0 ]]; then
  exit 1
fi

echo "[DONE] Test suite completed successfully."
