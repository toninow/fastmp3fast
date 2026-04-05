#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
. .venv/bin/activate

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

export PYTHONPATH="$(pwd)"
HOST="${APP_HOST:-127.0.0.1}"
PORT="${APP_PORT:-8001}"

exec python -m uvicorn app.main:app --host "$HOST" --port "$PORT" --reload
