#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/var/www/html/fastmp3fast"
BACKEND_DIR="$APP_ROOT/backend"
FRONTEND_DIR="$APP_ROOT/frontend"
APP_USER="antonio"
APP_GROUP="www-data"
API_PORT="9083"
APACHE_CONF="/etc/apache2/conf-available/fastmp3fast.conf"
SYSTEMD_UNIT="/etc/systemd/system/fastmp3fast-api.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este script con sudo: sudo bash $0"
  exit 1
fi

echo "[1/8] Instalando PHP 8.3 (CLI + extensiones necesarias)..."
apt-get update -y
apt-get install -y \
  php8.3 php8.3-cli php8.3-common php8.3-mbstring php8.3-xml php8.3-curl \
  php8.3-zip php8.3-mysql php8.3-sqlite3 php8.3-bcmath php8.3-intl php8.3-gd

echo "[2/8] Activando módulos Apache para proxy dedicado de FASTMP3FAST..."
a2enmod proxy proxy_http proxy_fcgi rewrite headers >/dev/null

echo "[3/8] Escribiendo conf Apache aislada en $APACHE_CONF ..."
cat > "$APACHE_CONF" <<'APACHE'
# FASTMP3FAST path deployment (aislado de otros proyectos)

# Frontend SPA
Alias /fastmp3fast /var/www/html/fastmp3fast/frontend/dist
<Directory /var/www/html/fastmp3fast/frontend/dist>
    Options -Indexes +FollowSymLinks
    AllowOverride None
    Require all granted

    RewriteEngine On
    RewriteBase /fastmp3fast/
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule ^ index.html [L]
</Directory>

# API backend (Laravel con PHP 8.3 en servicio dedicado)
ProxyPreserveHost On
ProxyPass /fastmp3fast/api/ http://127.0.0.1:9083/api/
ProxyPassReverse /fastmp3fast/api/ http://127.0.0.1:9083/api/

# Opcional: healthcheck del servicio de API
ProxyPass /fastmp3fast/up http://127.0.0.1:9083/up
ProxyPassReverse /fastmp3fast/up http://127.0.0.1:9083/up
APACHE

a2enconf fastmp3fast >/dev/null

echo "[4/8] Preparando .env backend para ejecución aislada..."
if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
fi

# helper seguro para upsert de variables .env
upsert_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$BACKEND_DIR/.env"; then
    sed -i "s#^${key}=.*#${key}=${value}#" "$BACKEND_DIR/.env"
  else
    echo "${key}=${value}" >> "$BACKEND_DIR/.env"
  fi
}

upsert_env "APP_NAME" "FASTMP3FAST"
upsert_env "APP_ENV" "production"
upsert_env "APP_DEBUG" "false"
upsert_env "APP_URL" "https://www.servidormp.com/fastmp3fast"
upsert_env "DB_CONNECTION" "sqlite"
upsert_env "DB_DATABASE" "$BACKEND_DIR/database/database.sqlite"
upsert_env "QUEUE_CONNECTION" "database"
upsert_env "CACHE_STORE" "file"
upsert_env "SESSION_DRIVER" "file"

mkdir -p "$BACKEND_DIR/database"
touch "$BACKEND_DIR/database/database.sqlite"
chown -R "$APP_USER:$APP_GROUP" "$APP_ROOT"

echo "[5/8] Instalando dependencias backend con PHP 8.3 + migraciones..."
# vendor se instala con PHP 8.3 para evitar incompatibilidades de sintaxis
sudo -u "$APP_USER" /usr/bin/php8.3 /usr/bin/composer install \
  --working-dir="$BACKEND_DIR" \
  --no-interaction --prefer-dist

sudo -u "$APP_USER" /usr/bin/php8.3 "$BACKEND_DIR/artisan" key:generate --force
sudo -u "$APP_USER" /usr/bin/php8.3 "$BACKEND_DIR/artisan" migrate --force
sudo -u "$APP_USER" /usr/bin/php8.3 "$BACKEND_DIR/artisan" db:seed --force

echo "[6/8] Build frontend con base /fastmp3fast/..."
sudo -u "$APP_USER" bash -lc "cd '$FRONTEND_DIR' && npm install && npm run build"

echo "[7/8] Creando servicio systemd de API (PHP 8.3 solo para FASTMP3FAST)..."
cat > "$SYSTEMD_UNIT" <<UNIT
[Unit]
Description=FASTMP3FAST Laravel API (PHP 8.3 isolated)
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$BACKEND_DIR
ExecStart=/usr/bin/php8.3 artisan serve --host=127.0.0.1 --port=$API_PORT
Restart=always
RestartSec=2
Environment=APP_ENV=production

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now fastmp3fast-api

echo "[8/8] Recargando Apache y validando..."
apache2ctl configtest
systemctl reload apache2
systemctl --no-pager --full status fastmp3fast-api | sed -n '1,18p'

echo ""
echo "Aplicación aislada completada."
echo "Frontend: https://www.servidormp.com/fastmp3fast/"
echo "API:      https://www.servidormp.com/fastmp3fast/api/v1/"
echo ""
