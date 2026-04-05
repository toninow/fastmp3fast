# FASTMP3FAST Python Backend (FastAPI)

Backend privado para reemplazar el uso directo de CMD con `yt-dlp`.

## Quickstart local

```bash
cd /var/www/html/fastmp3fast/python-backend
./bootstrap.sh
./run-dev.sh
```

API local:
- `http://127.0.0.1:8001/up`
- `http://127.0.0.1:8001/api/v1/auth/login`

Credenciales por defecto:
- usuario: `admin`
- password: `Fastmp3fast123!`

## Variables

Copia `.env.example` a `.env` y ajusta:
- `YT_DLP_BIN` (si usas binario custom)
- `YT_DLP_COOKIES_FILE` (ruta a `cookies.txt` exportado para YouTube, opcional)
- `YT_DLP_PROXY` (proxy HTTP/SOCKS, opcional)
- `YT_DLP_FORCE_IPV4` (`true/false`, recomendado `true` en servidores con bloqueos)
- `FFMPEG_BIN`
- `APP_PORT`

## Producción (systemd + Apache)

Archivos de ayuda en `deploy/`:
- `fastmp3fast-python-api.service`
- `apache-fastmp3fast-python.conf`

Pasos típicos:
1. Instalar dependencias + venv (`./bootstrap.sh`).
2. Copiar unit file a `/etc/systemd/system/`.
3. `sudo systemctl daemon-reload && sudo systemctl enable --now fastmp3fast-python-api`.
4. Incluir conf Apache de `deploy/apache-fastmp3fast-python.conf`.
5. `sudo systemctl reload apache2`.
