#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/var/www/html/fastmp3fast/python-backend"
PYTHON_BIN="$BASE_DIR/.venv/bin/python"
PID_FILE="$BASE_DIR/data/fastmp3fast-api.pid"
LOG_FILE="$BASE_DIR/data/fastmp3fast-api.log"
HOST="127.0.0.1"
PORT="8001"

is_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && ps -p "$pid" >/dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

start() {
  if is_running; then
    echo "FASTMP3FAST API ya está corriendo (PID $(cat "$PID_FILE"))."
    return 0
  fi

  cd "$BASE_DIR"
  mkdir -p "$(dirname "$PID_FILE")"
  : > "$LOG_FILE"
  setsid "$PYTHON_BIN" -m uvicorn app.main:app --host "$HOST" --port "$PORT" >>"$LOG_FILE" 2>&1 < /dev/null &
  local pid=$!
  echo "$pid" > "$PID_FILE"
  sleep 1

  if ps -p "$pid" >/dev/null 2>&1; then
    echo "FASTMP3FAST API iniciada (PID $pid) en http://$HOST:$PORT"
  else
    echo "No se pudo iniciar FASTMP3FAST API. Revisa $LOG_FILE"
    return 1
  fi
}

stop() {
  if ! is_running; then
    echo "FASTMP3FAST API no está corriendo."
    rm -f "$PID_FILE"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" || true
  sleep 1
  if ps -p "$pid" >/dev/null 2>&1; then
    kill -9 "$pid" || true
  fi
  rm -f "$PID_FILE"
  echo "FASTMP3FAST API detenida."
}

status() {
  if is_running; then
    echo "RUNNING PID $(cat "$PID_FILE")"
  else
    echo "STOPPED"
    return 1
  fi
}

restart() {
  stop || true
  start
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) restart ;;
  status) status ;;
  *)
    echo "Uso: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
