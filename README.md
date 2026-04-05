# FASTMP3FAST

Aplicación web privada tipo PWA offline-first para biblioteca multimedia, descargas y reproducción integrada.

## 1) Arquitectura final

- `frontend`:
  - React + Vite + TypeScript + Tailwind.
  - PWA real (`manifest.webmanifest` + `public/sw.js`).
  - IndexedDB (Dexie) como fuente local principal.
  - Estado global con Zustand.
  - Sincronización periódica con cola local (`pendingOperations`).
  - Reproductor persistente audio/video con subtítulos.

- `backend`:
  - Laravel 12 modular (`Controllers/Services/Jobs/Models`).
  - API REST privada con token Bearer hash (`api_tokens`).
  - Jobs/Queue para procesamiento de descargas.
  - Servicios dedicados: `YtDlpService`, `DownloadManagerService`, `MetadataParserService`, `FfmpegService`, `FileScannerService`, `SyncService`.

## 2) Árbol de directorios

```text
fastmp3fast/
├── backend/
│   ├── app/
│   │   ├── Enums/
│   │   ├── Http/
│   │   │   ├── Controllers/Api/
│   │   │   ├── Middleware/
│   │   │   └── Requests/Api/
│   │   ├── Jobs/
│   │   ├── Models/
│   │   ├── Services/
│   │   │   ├── Downloads/
│   │   │   └── Sync/
│   │   └── Support/
│   ├── config/fastmp3fast.php
│   ├── database/
│   │   ├── migrations/
│   │   └── seeders/
│   └── routes/api.php
├── frontend/
│   ├── public/
│   │   ├── manifest.webmanifest
│   │   └── sw.js
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── data/
│   │   ├── hooks/
│   │   ├── lib/
│   │   │   ├── api/
│   │   │   ├── db/
│   │   │   └── offline/
│   │   ├── pages/
│   │   ├── pwa/
│   │   ├── store/
│   │   └── types/
│   └── vite.config.ts
└── README.md
```

## 3) Modelo de datos

Backend (MySQL/MariaDB):
- `users`
- `downloads`
- `download_files`
- `collections`
- `collection_items`
- `tags`
- `download_tag`
- `subtitles`
- `playback_progress`
- `sync_operations`
- `activity_logs`
- `settings`
- `api_tokens`

Frontend IndexedDB:
- `downloads`
- `collections`
- `subtitles`
- `playbackProgress`
- `pendingOperations`
- `syncState`
- `cachedUser`
- `settings`
- `recentActivity`
- `notifications`

## 4) Flujo offline-first

1. UI lee primero desde IndexedDB.
2. Si no hay red, mutaciones se guardan en `pendingOperations`.
3. `useSyncEngine()` intenta sincronizar cada 20s cuando hay red.
4. Estado visual de sync: `offline | syncing | idle | synced | sync_error`.
5. Estrategia stale-while-revalidate con datos locales inmediatos.

## 5) Sistema de reproducción

- Mini player persistente inferior.
- Audio/video HTML5 integrado.
- Controles: play/pause, seek, volumen, mute, velocidad, prev/next.
- Subtítulos VTT/SRT (selector de idioma ON/OFF en player).
- Reanudación visual y progreso persistente.

## 6) API REST

Prefijo: `/api/v1`

- Auth:
  - `POST /auth/login`
  - `GET /auth/me`
  - `POST /auth/logout`
- Dashboard:
  - `GET /dashboard`
- Downloads:
  - `GET /downloads`
  - `POST /downloads`
  - `GET /downloads/{download}`
  - `PUT /downloads/{download}`
  - `DELETE /downloads/{download}`
  - `POST /downloads/{download}/retry`
  - `GET /downloads/formats`
- Collections:
  - `GET/POST/PUT/DELETE /collections`
- Tags:
  - `GET/POST/DELETE /tags`
- Subtitles:
  - `GET /subtitles`
  - `POST /downloads/{download}/subtitles`
- Playback:
  - `GET /playback`
  - `PUT /downloads/{download}/playback`
- Sync:
  - `GET /sync`
  - `POST /sync`
  - `POST /sync/{syncOperation}/retry`
- Activity:
  - `GET /activity`
- Settings:
  - `GET /settings`
  - `PUT /settings`
- System:
  - `GET /system/status`

## 7) Backend por módulos

- Controladores API completos en `app/Http/Controllers/Api`.
- Validaciones de entrada en `app/Http/Requests/Api`.
- Middleware de auth privada por Bearer token: `AuthenticateApiToken`.
- Jobs:
  - `ProcessDownloadJob`
  - `RetrySyncJob`
- Servicios de descarga/sync implementados en `app/Services`.
- Seeder inicial admin + listas base en `database/seeders/AdminUserSeeder.php`.

## 8) Frontend por módulos

Pantallas implementadas:
- Login
- Dashboard
- Nueva descarga
- Biblioteca (cards + tabla)
- Detalle de descarga
- Listas
- Detalle de lista
- Historial
- Sincronización
- Configuración
- Mini player persistente

## 9) Tema visual FASTMP3FAST

- Base: negro profundo y grafito.
- Primario: verde neón `#A3FF12`.
- Secundario: amarillo neón `#F7E733`.
- Estados: `pending/processing/completed/error/offline/syncing/playing/paused` con badges coherentes.
- Glow sutil en elementos activos.

## Notas de entorno

- Frontend compilado OK (`npm run build`).
- Backend Laravel 12 quedó implementado, pero en este servidor actual (`PHP 8.1`) no puede ejecutarse completo; requiere subir a `PHP 8.3+` para runtime final.

## Backend Python yt-dlp (activo para tu flujo sin CMD)

Se agregó backend FastAPI en [python-backend](/var/www/html/fastmp3fast/python-backend) para ejecutar `yt-dlp` vía API.

Quickstart local:

```bash
cd /var/www/html/fastmp3fast/python-backend
./bootstrap.sh
./run-dev.sh
```

Despliegue productivo con Apache + systemd:

```bash
sudo bash /var/www/html/fastmp3fast/apply_fastmp3fast_python_api.sh
```

## Aplicación aislada PHP 8.3 en `/fastmp3fast`

Se incluye script automatizado para aislar FASTMP3FAST sin tocar otros proyectos:

```bash
sudo bash /var/www/html/fastmp3fast/apply_fastmp3fast_php83.sh
```

Qué hace el script:
- Instala PHP 8.3 (CLI + extensiones) sin cambiar el runtime de los otros proyectos.
- Publica frontend en `https://www.servidormp.com/fastmp3fast/`.
- Levanta API Laravel con PHP 8.3 en servicio dedicado `fastmp3fast-api` (puerto `127.0.0.1:9083`).
- Configura Apache con proxy solo para `/fastmp3fast/api/*`.
