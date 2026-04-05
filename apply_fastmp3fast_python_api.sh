#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/var/www/html/fastmp3fast"
PY_DIR="$APP_ROOT/python-backend"
FE_DIR="$APP_ROOT/frontend"
APP_USER="antonio"
APP_GROUP="www-data"
APACHE_CONF_TARGET="/etc/apache2/conf-available/fastmp3fast.conf"
SYSTEMD_UNIT_TARGET="/etc/systemd/system/fastmp3fast-python-api.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta con sudo: sudo bash $0"
  exit 1
fi

echo "[1/8] Dependencias base de Python..."
apt-get update -y
apt-get install -y python3 python3-venv python3-dev build-essential

echo "[2/8] Preparando entorno Python backend..."
if [[ ! -f "$PY_DIR/.env" ]]; then
  cp "$PY_DIR/.env.example" "$PY_DIR/.env"
fi

sed -i "s#^APP_ENV=.*#APP_ENV=production#" "$PY_DIR/.env" || true
sed -i "s#^APP_HOST=.*#APP_HOST=127.0.0.1#" "$PY_DIR/.env" || true
sed -i "s#^APP_PORT=.*#APP_PORT=8001#" "$PY_DIR/.env" || true

# Usar binario de yt-dlp dentro del venv para aislamiento
if grep -q '^YT_DLP_BIN=' "$PY_DIR/.env"; then
  sed -i "s#^YT_DLP_BIN=.*#YT_DLP_BIN=$PY_DIR/.venv/bin/yt-dlp#" "$PY_DIR/.env"
else
  echo "YT_DLP_BIN=$PY_DIR/.venv/bin/yt-dlp" >> "$PY_DIR/.env"
fi

chown -R "$APP_USER:$APP_GROUP" "$APP_ROOT"

sudo -u "$APP_USER" bash -lc "cd '$PY_DIR' && ./bootstrap.sh"

echo "[3/8] Build frontend..."
sudo -u "$APP_USER" bash -lc "cd '$FE_DIR' && npm install && npm run build"

echo "[4/8] Configurando systemd service FASTMP3FAST Python API..."
cp "$PY_DIR/deploy/fastmp3fast-python-api.service" "$SYSTEMD_UNIT_TARGET"
systemctl daemon-reload
systemctl enable --now fastmp3fast-python-api

# Si existe servicio previo PHP para fastmp3fast, apagarlo para evitar confusión
if systemctl list-unit-files | grep -q '^fastmp3fast-api.service'; then
  systemctl disable --now fastmp3fast-api || true
fi

echo "[5/8] Configurando Apache para /fastmp3fast..."
cp "$PY_DIR/deploy/apache-fastmp3fast-python.conf" "$APACHE_CONF_TARGET"
a2enmod proxy proxy_http proxy_fcgi rewrite headers >/dev/null
a2enconf fastmp3fast >/dev/null

echo "[6/8] Validando configuración Apache..."
apache2ctl configtest

echo "[7/8] Recargando servicios..."
systemctl restart fastmp3fast-python-api
systemctl reload apache2

echo "[8/8] Estado final..."
systemctl --no-pager --full status fastmp3fast-python-api | sed -n '1,25p'

echo ""
echo "Listo."
echo "Frontend: https://www.servidormp.com/fastmp3fast/"
echo "API:      https://www.servidormp.com/fastmp3fast/api/v1/"
echo ""
