from __future__ import annotations

import json
import mimetypes
import platform
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, HTTPException, Query, Security, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import execute, fetch_all, fetch_one, now_iso, to_json
from .downloader import (
    create_download,
    enqueue_download,
    hydrate_download_tags,
    list_pending_sync,
    probe_formats,
    recommendations,
    system_status,
    worker,
    youtube_search,
)
from .schemas import (
    ApiResponse,
    CollectionCreateRequest,
    DownloadCreateRequest,
    DownloadUpdateRequest,
    LoginRequest,
    PlaybackUpsertRequest,
    SettingsUpsertRequest,
    SubtitleCreateRequest,
    SyncStoreRequest,
    UserCreateRequest,
)
from .security import bearer_scheme, create_token, get_current_user, hash_password, invalidate_token, verify_password


app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



def ok(data: Any = None, message: str = "OK") -> dict[str, Any]:
    return ApiResponse(ok=True, message=message, data=data).model_dump()



def _public_download_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "video_quality",
        "audio_quality",
        "actual_video_height",
        "actual_audio_bitrate_kbps",
        "video_height",
        "video_width",
        "audio_bitrate_kbps",
        "video_codec",
        "audio_codec",
        "format_id",
        "height",
        "abr",
        "save_thumbnail",
        "save_metadata",
        "source_url_normalized",
        "progress_percent",
        "progress_speed",
        "progress_eta",
        "progress_line",
        "progress_state",
        "progress_updated_at",
    }
    return {key: metadata.get(key) for key in allowed if key in metadata}


def _as_download(row: dict[str, Any]) -> dict[str, Any]:
    row = dict(row)
    row["favorite"] = bool(row.get("favorite", 0))
    row["archived"] = bool(row.get("archived", 0))
    row["file_exists"] = bool(row.get("file_exists", 0))
    subtitle_languages = row.get("subtitle_languages")
    metadata = row.get("metadata")

    if isinstance(subtitle_languages, str):
        row["subtitle_languages"] = json.loads(subtitle_languages or "[]")
    elif isinstance(subtitle_languages, list):
        row["subtitle_languages"] = subtitle_languages
    else:
        row["subtitle_languages"] = []

    if isinstance(metadata, str):
        row["metadata"] = json.loads(metadata or "{}") if metadata else {}
    elif isinstance(metadata, dict):
        row["metadata"] = metadata
    else:
        row["metadata"] = {}
    row["metadata"] = _public_download_metadata(row["metadata"])
    return row



def _get_download_or_404(download_id: int, user_id: int) -> dict[str, Any]:
    row = fetch_one("SELECT * FROM downloads WHERE id = ? AND user_id = ?", (download_id, user_id))
    if not row:
        raise HTTPException(status_code=404, detail="Download not found")
    return _as_download(row)


def _get_collection_or_404(collection_id: int, user_id: int) -> dict[str, Any]:
    row = fetch_one("SELECT * FROM collections WHERE id = ? AND user_id = ?", (collection_id, user_id))
    if not row:
        raise HTTPException(status_code=404, detail="Collection not found")
    return row


def _get_download_by_local_uid_or_404(local_uid: str, user_id: int) -> dict[str, Any]:
    row = fetch_one("SELECT * FROM downloads WHERE user_id = ? AND local_uid = ?", (user_id, local_uid))
    if not row:
        raise HTTPException(status_code=404, detail="Download not found")
    return _as_download(row)


def _resolve_download_id(download_ref: Any, user_id: int) -> int:
    if isinstance(download_ref, int):
        _get_download_or_404(download_ref, user_id=user_id)
        return download_ref

    value = str(download_ref or "").strip()
    if not value:
        raise HTTPException(status_code=422, detail="Invalid download reference")

    if value.isdigit():
        parsed = int(value)
        _get_download_or_404(parsed, user_id=user_id)
        return parsed

    row = fetch_one(
        """
        SELECT id
        FROM downloads
        WHERE user_id = ?
          AND (local_uid = ? OR remote_id = ?)
        LIMIT 1
        """,
        (user_id, value, value),
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"Download not found for reference: {value}")
    return int(row["id"])


def _get_current_user_for_media(
    access_token: str | None = Query(default=None),
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> dict[str, Any]:
    if credentials and credentials.credentials:
        return get_current_user(credentials)

    if access_token:
        return get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=access_token))

    raise HTTPException(status_code=401, detail="Unauthorized")


def _resolve_media_path_or_404(download_row: dict[str, Any]) -> Path:
    media_path = str(download_row.get("media_path") or "").strip()
    if not media_path:
        raise HTTPException(status_code=404, detail="Media file not available")

    path = Path(media_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Media file not found on disk")

    return path


def _get_subtitle_or_404(subtitle_id: int, user_id: int) -> dict[str, Any]:
    row = fetch_one(
        """
        SELECT s.*, d.local_uid as download_local_uid
        FROM subtitles s
        INNER JOIN downloads d ON d.id = s.download_id
        WHERE s.id = ? AND d.user_id = ?
        LIMIT 1
        """,
        (subtitle_id, user_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Subtitle not found")
    return row


def _path_within(base: Path, target: Path) -> bool:
    try:
        target.resolve().relative_to(base.resolve())
        return True
    except Exception:
        return False


def _cleanup_download_artifacts(download_row: dict[str, Any]) -> None:
    download_id = int(download_row.get("id") or 0)
    paths: set[str] = set()

    for key in ("media_path", "thumbnail_path"):
        value = str(download_row.get(key) or "").strip()
        if value:
            paths.add(value)

    file_rows = fetch_all("SELECT path FROM download_files WHERE download_id = ?", (download_id,))
    subtitle_rows = fetch_all("SELECT path FROM subtitles WHERE download_id = ?", (download_id,))

    for row in [*file_rows, *subtitle_rows]:
        value = str(row.get("path") or "").strip()
        if value:
            paths.add(value)

    managed_roots = [Path(settings.downloads_dir).resolve(), Path(settings.subtitles_dir).resolve(), Path(settings.data_dir).resolve()]
    for raw_path in paths:
        try:
            path = Path(raw_path).resolve()
            if not any(_path_within(root, path) for root in managed_roots):
                continue
            if path.exists() and path.is_file():
                path.unlink(missing_ok=True)
        except Exception:
            continue

    try:
        download_dir = (Path(settings.downloads_dir) / str(download_id)).resolve()
        if _path_within(Path(settings.downloads_dir).resolve(), download_dir) and download_dir.exists() and download_dir.is_dir():
            shutil.rmtree(download_dir, ignore_errors=True)
    except Exception:
        pass


def _resolve_subtitle_path_or_404(subtitle_row: dict[str, Any]) -> Path:
    subtitle_path = str(subtitle_row.get("path") or "").strip()
    if not subtitle_path:
        raise HTTPException(status_code=404, detail="Subtitle file not available")

    path = Path(subtitle_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Subtitle file not found on disk")

    return path


def _assert_admin(user: dict[str, Any]) -> None:
    if not bool(user.get("is_admin")):
        raise HTTPException(status_code=403, detail="Only admin users can do this action")


def _settings_key(user_id: int, key: str) -> str:
    return f"user:{user_id}:{key}"


def _settings_key_prefix(user_id: int) -> str:
    return f"user:{user_id}:"


def _apply_download_updates(download_id: int, user_id: int, current: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    if "custom_name" in values:
        execute(
            "UPDATE downloads SET custom_name = ?, title = ? WHERE id = ? AND user_id = ?",
            (values["custom_name"], values["custom_name"] or current["title"], download_id, user_id),
        )
    if "collection_id" in values:
        execute("UPDATE downloads SET collection_id = ? WHERE id = ? AND user_id = ?", (values["collection_id"], download_id, user_id))
    if "favorite" in values:
        execute("UPDATE downloads SET favorite = ? WHERE id = ? AND user_id = ?", (1 if values["favorite"] else 0, download_id, user_id))
    if "archived" in values:
        execute("UPDATE downloads SET archived = ? WHERE id = ? AND user_id = ?", (1 if values["archived"] else 0, download_id, user_id))
    if "notes" in values:
        execute("UPDATE downloads SET notes = ? WHERE id = ? AND user_id = ?", (values["notes"], download_id, user_id))
    if "status" in values:
        execute("UPDATE downloads SET status = ? WHERE id = ? AND user_id = ?", (values["status"], download_id, user_id))

    if "tags" in values and values["tags"] is not None:
        execute("DELETE FROM download_tag WHERE download_id = ?", (download_id,))
        for tag_name in values["tags"]:
            t = fetch_one("SELECT id FROM tags WHERE user_id = ? AND name = ?", (user_id, tag_name))
            if t:
                tag_id = t["id"]
            else:
                tag_id = execute(
                    "INSERT INTO tags(user_id, name, color, created_at) VALUES(?,?,?,?)",
                    (user_id, tag_name, "#F7E733", now_iso()),
                ).lastrowid
            execute("INSERT OR IGNORE INTO download_tag(download_id, tag_id) VALUES(?, ?)", (download_id, tag_id))

    return _get_download_or_404(download_id, user_id=user_id)


@app.on_event("startup")
def on_startup() -> None:
    worker.start()


@app.get("/up")
def up() -> dict[str, Any]:
    return ok({"status": "up", "service": "fastmp3fast-python-api"})


@app.post("/api/v1/auth/login")
def login(payload: LoginRequest) -> dict[str, Any]:
    login_value = payload.login.strip().lower()
    user = fetch_one(
        """
        SELECT * FROM users
        WHERE LOWER(username) = ? OR LOWER(email) = ?
        LIMIT 1
        """,
        (login_value, login_value),
    )

    if not user:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    if int(user.get("is_active") or 0) != 1:
        raise HTTPException(status_code=401, detail="Usuario inactivo")

    if not verify_password(payload.password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

    token = create_token(int(user["id"]), str(user["username"]), remember=payload.remember)
    ts = now_iso()
    execute("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?", (ts, ts, user["id"]))
    safe_user = {
        "id": int(user["id"]),
        "name": user.get("name") or user.get("username"),
        "email": user.get("email"),
        "username": user.get("username"),
        "is_admin": bool(int(user.get("is_admin") or 0)),
    }

    return ok({"token": token, "token_type": "Bearer", "user": safe_user}, "Login correcto")


@app.get("/api/v1/auth/me")
def auth_me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return ok(user)


@app.post("/api/v1/auth/logout")
def logout(
    user: dict[str, Any] = Depends(get_current_user),
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> dict[str, Any]:
    _ = user
    if credentials:
        invalidate_token(credentials.credentials)
    return ok(None, "Sesión cerrada")


@app.post("/api/v1/users")
def create_user(payload: UserCreateRequest, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    _assert_admin(user)
    username = payload.username.strip().lower()
    email = payload.email.strip().lower() if payload.email else None
    name = payload.name.strip() if payload.name else username
    ts = now_iso()

    existing = fetch_one(
        "SELECT id FROM users WHERE LOWER(username) = ? OR (? IS NOT NULL AND LOWER(email) = ?)",
        (username, email, email),
    )
    if existing:
        raise HTTPException(status_code=422, detail="Username/email ya existe")

    try:
        user_id = execute(
            """
            INSERT INTO users(username, email, name, password_hash, is_active, is_admin, created_at, updated_at)
            VALUES(?, ?, ?, ?, 1, ?, ?, ?)
            """,
            (username, email, name, hash_password(payload.password), 1 if payload.is_admin else 0, ts, ts),
        ).lastrowid
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"No se pudo crear el usuario: {exc}") from exc

    created = fetch_one(
        "SELECT id, username, email, name, is_admin, is_active, created_at FROM users WHERE id = ?",
        (user_id,),
    )
    return ok(created, "Usuario creado")


@app.get("/api/v1/users")
def list_users(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    _assert_admin(user)
    rows = fetch_all(
        """
        SELECT
            u.id,
            u.username,
            u.email,
            u.name,
            u.is_admin,
            u.is_active,
            u.last_login_at,
            u.created_at,
            (
                SELECT COUNT(*) FROM downloads d WHERE d.user_id = u.id
            ) AS downloads_count,
            (
                SELECT COUNT(*) FROM collections c WHERE c.user_id = u.id
            ) AS collections_count
        FROM users u
        ORDER BY u.id ASC
        """
    )
    return ok(rows)


@app.get("/api/v1/dashboard")
def dashboard(
    user: dict[str, Any] = Depends(get_current_user),
    scope: str = "mine",
) -> dict[str, Any]:
    user_id = int(user["id"])
    is_admin = bool(user.get("is_admin"))
    global_scope = scope == "all" and is_admin

    where = "1=1" if global_scope else "user_id = ?"
    params: tuple[Any, ...] = tuple() if global_scope else (user_id,)

    total = fetch_one(f"SELECT COUNT(*) as c FROM downloads WHERE {where}", params)
    videos = fetch_one(f"SELECT COUNT(*) as c FROM downloads WHERE {where} AND type LIKE '%video%'", params)
    audios = fetch_one(f"SELECT COUNT(*) as c FROM downloads WHERE {where} AND type LIKE '%audio%'", params)
    playlists = fetch_one(f"SELECT COUNT(*) as c FROM downloads WHERE {where} AND type LIKE '%playlist%'", params)
    errors = fetch_one(f"SELECT COUNT(*) as c FROM downloads WHERE {where} AND status = 'error'", params)
    pending = fetch_one(
        f"SELECT COUNT(*) as c FROM downloads WHERE {where} AND status IN ('pending','queued','processing','offline')",
        params,
    )
    favorites = fetch_one(f"SELECT COUNT(*) as c FROM downloads WHERE {where} AND favorite = 1", params)
    with_subs = fetch_one(
        f"SELECT COUNT(*) as c FROM downloads WHERE {where} AND subtitle_languages IS NOT NULL AND subtitle_languages != '[]'",
        params,
    )

    if global_scope:
        recent_downloads = hydrate_download_tags(
            fetch_all(
                """
                SELECT d.*, u.username AS owner_username, u.name AS owner_name
                FROM downloads d
                LEFT JOIN users u ON u.id = d.user_id
                ORDER BY d.id DESC
                LIMIT 8
                """
            )
        )
        recent_activity = fetch_all(
            """
            SELECT al.*, u.username AS owner_username
            FROM activity_logs al
            LEFT JOIN users u ON u.id = al.user_id
            ORDER BY al.id DESC
            LIMIT 10
            """
        )
        sync_queue = fetch_all("SELECT * FROM sync_operations ORDER BY id DESC LIMIT 100")
    else:
        recent_downloads = hydrate_download_tags(fetch_all("SELECT * FROM downloads WHERE user_id = ? ORDER BY id DESC LIMIT 8", (user_id,)), user_id=user_id)
        recent_activity = fetch_all("SELECT * FROM activity_logs WHERE user_id = ? ORDER BY id DESC LIMIT 10", (user_id,))
        sync_queue = list_pending_sync(user_id)

    return ok(
        {
            "kpis": {
                "total_downloads": total["c"],
                "videos": videos["c"],
                "audios": audios["c"],
                "playlists": playlists["c"],
                "errors": errors["c"],
                "pending": pending["c"],
                "favorites": favorites["c"],
                "with_subtitles": with_subs["c"],
            },
            "recent_downloads": [_as_download(x) for x in recent_downloads],
            "recent_activity": recent_activity,
            "sync_queue": sync_queue,
            "connection_status": {
                "backend": "online",
                "queue_pending": len([x for x in sync_queue if x.get("status") == "pending"]),
            },
            "scope": "all" if global_scope else "mine",
        }
    )


@app.get("/api/v1/downloads")
def list_downloads(
    user: dict[str, Any] = Depends(get_current_user),
    q: str = "",
    status: str = "",
    scope: str = "mine",
    target_user_id: int | None = None,
    page: int = 1,
    per_page: int = 20,
) -> dict[str, Any]:
    user_id = int(user["id"])
    is_admin = bool(user.get("is_admin"))

    where: list[str] = []
    params: list[Any] = []
    global_scope = scope == "all" and is_admin

    if global_scope:
        if target_user_id:
            where.append("d.user_id = ?")
            params.append(target_user_id)
    else:
        where.append("d.user_id = ?")
        params.append(user_id)

    if q:
        where.append("(d.title LIKE ? OR d.custom_name LIKE ? OR d.uploader LIKE ?)")
        pattern = f"%{q}%"
        params.extend([pattern, pattern, pattern])

    if status:
        where.append("d.status = ?")
        params.append(status)

    where_sql = " WHERE " + " AND ".join(where) if where else " WHERE 1=1"

    total_row = fetch_one(f"SELECT COUNT(*) as c FROM downloads d{where_sql}", params)
    offset = max(page - 1, 0) * per_page
    rows = fetch_all(
        f"""
        SELECT d.*, u.username as owner_username, u.name as owner_name
        FROM downloads d
        LEFT JOIN users u ON u.id = d.user_id
        {where_sql}
        ORDER BY d.id DESC
        LIMIT ? OFFSET ?
        """,
        [*params, per_page, offset],
    )
    rows = hydrate_download_tags(rows, user_id=user_id if not global_scope else None)

    return ok(
        {
            "data": [_as_download(r) for r in rows],
            "total": total_row["c"] if total_row else 0,
            "page": page,
            "per_page": per_page,
            "scope": "all" if global_scope else "mine",
        }
    )


@app.post("/api/v1/downloads")
def store_download(payload: DownloadCreateRequest, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    try:
        row = create_download(payload.model_dump(), user_id=user_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    data = _as_download(row)
    if data.get("already_exists"):
        return ok(data, "Ya existe una descarga para ese enlace")
    return ok(data, "Solicitud creada")


@app.get("/api/v1/downloads/formats")
def formats(url: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    _ = user
    return ok(probe_formats(url))


@app.get("/api/v1/youtube/search")
def search_youtube_endpoint(
    q: str,
    limit: int = 10,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _ = user
    return ok(youtube_search(q, limit=limit))


@app.get("/api/v1/recommendations")
def recommendations_endpoint(
    limit: int = 12,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = int(user["id"])
    data = recommendations(user_id=user_id, limit=limit)
    return ok(data)


@app.get("/api/v1/downloads/{download_id}")
def show_download(download_id: int, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    row = _get_download_or_404(download_id, user_id=user_id)
    row["tags"] = [x["name"] for x in fetch_all(
        "SELECT t.name FROM tags t INNER JOIN download_tag dt ON dt.tag_id=t.id WHERE dt.download_id=? AND t.user_id=?",
        (download_id, user_id),
    )]
    row["subtitles"] = fetch_all("SELECT * FROM subtitles WHERE download_id=? ORDER BY id ASC", (download_id,))
    row["files"] = fetch_all("SELECT * FROM download_files WHERE download_id=? ORDER BY id DESC", (download_id,))
    row["playback"] = fetch_one(
        """
        SELECT pp.*
        FROM playback_progress pp
        INNER JOIN downloads d ON d.id = pp.download_id
        WHERE pp.download_id = ? AND d.user_id = ?
        """,
        (download_id, user_id),
    )
    return ok(row)


@app.get("/api/v1/downloads/{download_id}/stream")
def stream_download_media(download_id: int, user: dict[str, Any] = Depends(_get_current_user_for_media)):
    user_id = int(user["id"])
    row = _get_download_or_404(download_id, user_id=user_id)
    media_file = _resolve_media_path_or_404(row)
    media_type = mimetypes.guess_type(media_file.name)[0] or "application/octet-stream"
    return FileResponse(
        path=str(media_file),
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{media_file.name}"'},
    )


@app.get("/api/v1/downloads/{download_id}/download")
def download_media_file(download_id: int, user: dict[str, Any] = Depends(_get_current_user_for_media)):
    user_id = int(user["id"])
    row = _get_download_or_404(download_id, user_id=user_id)
    media_file = _resolve_media_path_or_404(row)
    media_type = mimetypes.guess_type(media_file.name)[0] or "application/octet-stream"
    return FileResponse(
        path=str(media_file),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{media_file.name}"'},
    )


@app.put("/api/v1/downloads/{download_id}")
def update_download(
    download_id: int,
    payload: DownloadUpdateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = int(user["id"])
    current = _get_download_or_404(download_id, user_id=user_id)
    values = payload.model_dump(exclude_none=True)
    updated = _apply_download_updates(download_id, user_id, current, values)
    return ok(updated, "Elemento actualizado")


@app.put("/api/v1/downloads/by-local/{local_uid}")
def update_download_by_local_uid(
    local_uid: str,
    payload: DownloadUpdateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = int(user["id"])
    current = _get_download_by_local_uid_or_404(local_uid, user_id=user_id)
    values = payload.model_dump(exclude_none=True)
    updated = _apply_download_updates(int(current["id"]), user_id, current, values)
    return ok(updated, "Elemento actualizado")


@app.delete("/api/v1/downloads/{download_id}")
def destroy_download(download_id: int, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    row = _get_download_or_404(download_id, user_id=user_id)
    _cleanup_download_artifacts(row)
    execute("DELETE FROM downloads WHERE id = ? AND user_id = ?", (download_id, user_id))
    return ok(None, "Elemento eliminado")


@app.delete("/api/v1/downloads/by-local/{local_uid}")
def destroy_download_by_local_uid(local_uid: str, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    current = _get_download_by_local_uid_or_404(local_uid, user_id=user_id)
    _cleanup_download_artifacts(current)
    execute("DELETE FROM downloads WHERE id = ? AND user_id = ?", (int(current["id"]), user_id))
    return ok(None, "Elemento eliminado")


@app.get("/api/v1/downloads/by-local/{local_uid}/stream")
def stream_download_media_by_local_uid(local_uid: str, user: dict[str, Any] = Depends(_get_current_user_for_media)):
    user_id = int(user["id"])
    row = _get_download_by_local_uid_or_404(local_uid, user_id=user_id)
    media_file = _resolve_media_path_or_404(row)
    media_type = mimetypes.guess_type(media_file.name)[0] or "application/octet-stream"
    return FileResponse(
        path=str(media_file),
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{media_file.name}"'},
    )


@app.get("/api/v1/downloads/by-local/{local_uid}/download")
def download_media_file_by_local_uid(local_uid: str, user: dict[str, Any] = Depends(_get_current_user_for_media)):
    user_id = int(user["id"])
    row = _get_download_by_local_uid_or_404(local_uid, user_id=user_id)
    media_file = _resolve_media_path_or_404(row)
    media_type = mimetypes.guess_type(media_file.name)[0] or "application/octet-stream"
    return FileResponse(
        path=str(media_file),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{media_file.name}"'},
    )


@app.post("/api/v1/downloads/{download_id}/retry")
def retry_download(download_id: int, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    _get_download_or_404(download_id, user_id=user_id)
    execute("UPDATE downloads SET status = 'queued', error_message = NULL WHERE id = ? AND user_id = ?", (download_id, user_id))
    enqueue_download(download_id)
    return ok(_get_download_or_404(download_id, user_id=user_id), "Reintento en cola")


@app.get("/api/v1/collections")
def list_collections(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    rows = fetch_all("SELECT * FROM collections WHERE user_id = ? ORDER BY sort_order ASC, id ASC", (user_id,))
    for row in rows:
        row["items_count"] = fetch_one(
            "SELECT COUNT(*) as c FROM collection_items WHERE collection_id = ?", (row["id"],)
        )["c"]
        row["item_ids"] = [
            entry["local_uid"]
            for entry in fetch_all(
                """
                SELECT d.local_uid
                FROM collection_items ci
                INNER JOIN downloads d ON d.id = ci.download_id
                WHERE ci.collection_id = ? AND d.user_id = ?
                ORDER BY ci.position ASC
                """,
                (row["id"], user_id),
            )
            if entry.get("local_uid")
        ]
    return ok(rows)


@app.post("/api/v1/collections")
def create_collection(payload: CollectionCreateRequest, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    ts = now_iso()
    local_id = f"col-{uuid.uuid4().hex[:10]}"
    cur = execute(
        """
        INSERT INTO collections(user_id, local_id, name, description, color, icon, is_system, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
        """,
        (user_id, local_id, payload.name, payload.description, payload.color, payload.icon, payload.sort_order, ts, ts),
    )
    collection_id = int(cur.lastrowid)

    for idx, download_ref in enumerate(payload.item_ids):
        download_id = _resolve_download_id(download_ref, user_id=user_id)
        execute(
            "INSERT OR IGNORE INTO collection_items(collection_id, download_id, position, created_at) VALUES(?,?,?,?)",
            (collection_id, download_id, idx, ts),
        )
    row = fetch_one("SELECT * FROM collections WHERE id = ? AND user_id = ?", (collection_id, user_id)) or {}
    row["item_ids"] = [
        entry["local_uid"]
        for entry in fetch_all(
            """
            SELECT d.local_uid
            FROM collection_items ci
            INNER JOIN downloads d ON d.id = ci.download_id
            WHERE ci.collection_id = ? AND d.user_id = ?
            ORDER BY ci.position ASC
            """,
            (collection_id, user_id),
        )
        if entry.get("local_uid")
    ]
    return ok(row, "Lista creada")


@app.get("/api/v1/collections/{collection_id}")
def show_collection(collection_id: int, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    row = _get_collection_or_404(collection_id, user_id=user_id)

    items = fetch_all(
        """
        SELECT ci.*, d.title, d.custom_name, d.status, d.type, d.media_path, d.local_uid, d.remote_id
        FROM collection_items ci
        INNER JOIN downloads d ON d.id = ci.download_id
        WHERE ci.collection_id = ? AND d.user_id = ?
        ORDER BY ci.position ASC
        """,
        (collection_id, user_id),
    )
    row["items"] = items
    row["item_ids"] = [x["local_uid"] for x in items if x.get("local_uid")]
    return ok(row)


@app.put("/api/v1/collections/{collection_id}")
def update_collection(
    collection_id: int,
    payload: CollectionCreateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = int(user["id"])
    _get_collection_or_404(collection_id, user_id=user_id)

    execute(
        """
        UPDATE collections
        SET name = ?, description = ?, color = ?, icon = ?, sort_order = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
        """,
        (
            payload.name,
            payload.description,
            payload.color,
            payload.icon,
            payload.sort_order,
            now_iso(),
            collection_id,
            user_id,
        ),
    )

    execute("DELETE FROM collection_items WHERE collection_id = ?", (collection_id,))
    for idx, download_ref in enumerate(payload.item_ids):
        download_id = _resolve_download_id(download_ref, user_id=user_id)
        execute(
            "INSERT OR IGNORE INTO collection_items(collection_id, download_id, position, created_at) VALUES(?,?,?,?)",
            (collection_id, download_id, idx, now_iso()),
        )
    row = fetch_one("SELECT * FROM collections WHERE id = ? AND user_id = ?", (collection_id, user_id)) or {}
    row["item_ids"] = [
        entry["local_uid"]
        for entry in fetch_all(
            """
            SELECT d.local_uid
            FROM collection_items ci
            INNER JOIN downloads d ON d.id = ci.download_id
            WHERE ci.collection_id = ? AND d.user_id = ?
            ORDER BY ci.position ASC
            """,
            (collection_id, user_id),
        )
        if entry.get("local_uid")
    ]
    return ok(row, "Lista actualizada")


@app.delete("/api/v1/collections/{collection_id}")
def delete_collection(collection_id: int, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    _get_collection_or_404(collection_id, user_id=user_id)
    execute("DELETE FROM collections WHERE id = ? AND user_id = ?", (collection_id, user_id))
    return ok(None, "Lista eliminada")


@app.get("/api/v1/tags")
def list_tags(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    return ok(fetch_all("SELECT * FROM tags WHERE user_id = ? ORDER BY name ASC", (user_id,)))


@app.post("/api/v1/tags")
def create_tag(payload: dict[str, Any], user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    name = str(payload.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is required")

    existing = fetch_one("SELECT * FROM tags WHERE user_id = ? AND name = ?", (user_id, name))
    if existing:
        return ok(existing, "Etiqueta existente")

    tag_id = execute(
        "INSERT INTO tags(user_id, name, color, created_at) VALUES(?,?,?,?)",
        (user_id, name, payload.get("color", "#F7E733"), now_iso()),
    ).lastrowid
    return ok(fetch_one("SELECT * FROM tags WHERE id = ? AND user_id = ?", (tag_id, user_id)), "Etiqueta creada")


@app.delete("/api/v1/tags/{tag_id}")
def delete_tag(tag_id: int, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    execute("DELETE FROM tags WHERE id = ? AND user_id = ?", (tag_id, user_id))
    return ok(None, "Etiqueta eliminada")


@app.get("/api/v1/subtitles")
def list_subtitles(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    return ok(
        fetch_all(
            """
            SELECT s.*, d.local_uid as download_local_uid
            FROM subtitles s
            INNER JOIN downloads d ON d.id = s.download_id
            WHERE d.user_id = ?
            ORDER BY s.id DESC
            LIMIT 200
            """,
            (user_id,),
        )
    )


@app.get("/api/v1/subtitles/{subtitle_id}/file")
def stream_subtitle_file(subtitle_id: int, user: dict[str, Any] = Depends(_get_current_user_for_media)):
    user_id = int(user["id"])
    row = _get_subtitle_or_404(subtitle_id, user_id=user_id)
    subtitle_file = _resolve_subtitle_path_or_404(row)
    media_type = "text/vtt" if subtitle_file.suffix.lower() == ".vtt" else "text/plain"
    return FileResponse(
        path=str(subtitle_file),
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{subtitle_file.name}"'},
    )


@app.get("/api/v1/downloads/by-local/{local_uid}/subtitles/{subtitle_id}/file")
def stream_subtitle_file_by_local_uid(
    local_uid: str,
    subtitle_id: int,
    user: dict[str, Any] = Depends(_get_current_user_for_media),
):
    user_id = int(user["id"])
    download = _get_download_by_local_uid_or_404(local_uid, user_id=user_id)
    row = _get_subtitle_or_404(subtitle_id, user_id=user_id)
    if int(row.get("download_id") or 0) != int(download.get("id") or 0):
        raise HTTPException(status_code=404, detail="Subtitle not found for this download")
    subtitle_file = _resolve_subtitle_path_or_404(row)
    media_type = "text/vtt" if subtitle_file.suffix.lower() == ".vtt" else "text/plain"
    return FileResponse(
        path=str(subtitle_file),
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{subtitle_file.name}"'},
    )


@app.post("/api/v1/downloads/{download_id}/subtitles")
def create_subtitle(
    download_id: int,
    payload: SubtitleCreateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = int(user["id"])
    _get_download_or_404(download_id, user_id=user_id)
    sub_id = execute(
        "INSERT INTO subtitles(download_id, language, format, path, is_default, created_at) VALUES(?,?,?,?,?,?)",
        (download_id, payload.language, payload.format, payload.path, 1 if payload.is_default else 0, now_iso()),
    ).lastrowid
    return ok(fetch_one("SELECT * FROM subtitles WHERE id = ?", (sub_id,)), "Subtítulo registrado")


@app.get("/api/v1/playback")
def list_playback(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    return ok(
        fetch_all(
            """
            SELECT pp.*
            FROM playback_progress pp
            INNER JOIN downloads d ON d.id = pp.download_id
            WHERE d.user_id = ?
            ORDER BY pp.updated_at DESC
            LIMIT 200
            """,
            (user_id,),
        )
    )


@app.put("/api/v1/downloads/{download_id}/playback")
def upsert_playback(
    download_id: int,
    payload: PlaybackUpsertRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = int(user["id"])
    _get_download_or_404(download_id, user_id=user_id)

    ts = now_iso()
    execute(
        """
        INSERT INTO playback_progress(download_id, position_seconds, duration_seconds, percent, volume, speed, is_completed, updated_from, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(download_id) DO UPDATE SET
            position_seconds=excluded.position_seconds,
            duration_seconds=excluded.duration_seconds,
            percent=excluded.percent,
            volume=excluded.volume,
            speed=excluded.speed,
            is_completed=excluded.is_completed,
            updated_from=excluded.updated_from,
            updated_at=excluded.updated_at
        """,
        (
            download_id,
            payload.position_seconds,
            payload.duration_seconds,
            payload.percent,
            payload.volume,
            payload.speed,
            1 if payload.is_completed else 0,
            payload.updated_from,
            ts,
        ),
    )

    execute(
        "UPDATE downloads SET last_playback_position_seconds = ?, last_played_at = ? WHERE id = ?",
        (payload.position_seconds, ts, download_id),
    )

    row = fetch_one("SELECT * FROM playback_progress WHERE download_id = ?", (download_id,))
    return ok(row, "Progreso guardado")


@app.get("/api/v1/sync")
def sync_index(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    ops = fetch_all("SELECT * FROM sync_operations WHERE user_id = ? ORDER BY id DESC LIMIT 200", (user_id,))
    pending = len([x for x in ops if x.get("status") == "pending"])
    synced = len([x for x in ops if x.get("status") == "synced"])
    conflicts = len([x for x in ops if x.get("status") == "conflict"])
    errors = len([x for x in ops if x.get("status") == "error"])

    return ok(
        {
            "status": "online",
            "backend": "healthy",
            "pending": pending,
            "synced": synced,
            "conflicts": conflicts,
            "errors": errors,
            "operations": ops,
        }
    )


@app.post("/api/v1/sync")
def sync_store(payload: SyncStoreRequest, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    created: list[dict[str, Any]] = []
    ts = now_iso()

    for op in payload.operations:
        op_payload = op.payload or {}
        cur = execute(
            """
            INSERT INTO sync_operations(user_id, local_id, operation, entity_type, entity_local_id, entity_remote_id, payload, status, attempts, created_at)
            VALUES(?,?,?,?,?,?,?, 'pending', 0, ?)
            """,
            (
                user_id,
                str(uuid.uuid4()),
                op.operation,
                op.entity_type,
                op.entity_local_id,
                op.entity_remote_id,
                to_json(op_payload),
                ts,
            ),
        )
        sync_id = int(cur.lastrowid)

        try:
            if op.entity_type == "download" and op.operation in {"create", "upsert"}:
                create_payload = dict(op_payload)
                if op.entity_local_id and "local_uid" not in create_payload and "localId" not in create_payload:
                    create_payload["local_uid"] = op.entity_local_id
                created_download = create_download(create_payload, user_id=user_id, from_sync=True)
                execute(
                    "UPDATE sync_operations SET status = 'synced', synced_at = ?, entity_remote_id = ? WHERE id = ? AND user_id = ?",
                    (now_iso(), created_download.get("id"), sync_id, user_id),
                )
            elif op.entity_type == "collection" and op.operation in {"create", "upsert"}:
                local_id = str(op_payload.get("local_id") or op.entity_local_id or f"col-{uuid.uuid4().hex[:10]}")
                name = str(op_payload.get("name") or "").strip()
                if not name:
                    raise ValueError("collection name is required")

                description = op_payload.get("description")
                color = str(op_payload.get("color") or "#A3FF12")
                icon = str(op_payload.get("icon") or "folder")
                sort_order = int(op_payload.get("sort_order") or 0)
                ts2 = now_iso()

                existing = fetch_one(
                    "SELECT id FROM collections WHERE user_id = ? AND local_id = ? LIMIT 1",
                    (user_id, local_id),
                )

                if existing:
                    collection_id = int(existing["id"])
                    execute(
                        """
                        UPDATE collections
                        SET name = ?, description = ?, color = ?, icon = ?, sort_order = ?, updated_at = ?
                        WHERE id = ? AND user_id = ?
                        """,
                        (name, description, color, icon, sort_order, ts2, collection_id, user_id),
                    )
                else:
                    collection_id = int(
                        execute(
                            """
                            INSERT INTO collections(user_id, local_id, name, description, color, icon, is_system, sort_order, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
                            """,
                            (user_id, local_id, name, description, color, icon, sort_order, ts2, ts2),
                        ).lastrowid
                    )

                execute("DELETE FROM collection_items WHERE collection_id = ?", (collection_id,))
                for idx, download_ref in enumerate(op_payload.get("item_ids") or []):
                    download_id = _resolve_download_id(download_ref, user_id=user_id)
                    execute(
                        "INSERT OR IGNORE INTO collection_items(collection_id, download_id, position, created_at) VALUES(?,?,?,?)",
                        (collection_id, download_id, idx, ts2),
                    )

                execute(
                    "UPDATE sync_operations SET status = 'synced', synced_at = ?, entity_remote_id = ? WHERE id = ? AND user_id = ?",
                    (now_iso(), collection_id, sync_id, user_id),
                )
            elif op.entity_type == "collection" and op.operation == "delete":
                target_local_id = str(op_payload.get("local_id") or op.entity_local_id or "").strip()
                target_remote_id_raw = op.entity_remote_id or op_payload.get("remote_id") or op_payload.get("id")
                target_row: dict[str, Any] | None = None

                if target_remote_id_raw is not None:
                    try:
                        target_row = fetch_one(
                            "SELECT id FROM collections WHERE id = ? AND user_id = ?",
                            (int(target_remote_id_raw), user_id),
                        )
                    except Exception:
                        target_row = None

                if not target_row and target_local_id:
                    target_row = fetch_one(
                        "SELECT id FROM collections WHERE local_id = ? AND user_id = ?",
                        (target_local_id, user_id),
                    )

                target_collection_id = int(target_row["id"]) if target_row else None
                if target_collection_id:
                    execute("DELETE FROM collection_items WHERE collection_id = ?", (target_collection_id,))
                    execute("DELETE FROM collections WHERE id = ? AND user_id = ?", (target_collection_id, user_id))

                execute(
                    "UPDATE sync_operations SET status = 'synced', synced_at = ?, entity_remote_id = ? WHERE id = ? AND user_id = ?",
                    (now_iso(), target_collection_id, sync_id, user_id),
                )
            else:
                execute("UPDATE sync_operations SET status = 'synced', synced_at = ? WHERE id = ? AND user_id = ?", (now_iso(), sync_id, user_id))
        except Exception as exc:
            execute(
                "UPDATE sync_operations SET status = 'error', attempts = attempts + 1, last_error = ? WHERE id = ? AND user_id = ?",
                (str(exc), sync_id, user_id),
            )

        created.append(fetch_one("SELECT * FROM sync_operations WHERE id = ? AND user_id = ?", (sync_id, user_id)) or {})

    return ok(created, "Operaciones registradas")


@app.post("/api/v1/sync/{sync_id}/retry")
def retry_sync(sync_id: int, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    op = fetch_one("SELECT * FROM sync_operations WHERE id = ? AND user_id = ?", (sync_id, user_id))
    if not op:
        raise HTTPException(status_code=404, detail="Sync operation not found")

    execute(
        "UPDATE sync_operations SET status = 'synced', synced_at = ?, last_error = NULL WHERE id = ? AND user_id = ?",
        (now_iso(), sync_id, user_id),
    )
    return ok(fetch_one("SELECT * FROM sync_operations WHERE id = ? AND user_id = ?", (sync_id, user_id)), "Reintento programado")


@app.get("/api/v1/activity")
def list_activity(
    user: dict[str, Any] = Depends(get_current_user),
    event: str = "",
    page: int = 1,
    per_page: int = 30,
) -> dict[str, Any]:
    user_id = int(user["id"])
    where = "WHERE user_id = ?"
    params: list[Any] = [user_id]
    if event:
        where += " AND event = ?"
        params.append(event)

    total_row = fetch_one(f"SELECT COUNT(*) as c FROM activity_logs {where}", params)
    offset = max(page - 1, 0) * per_page
    rows = fetch_all(
        f"SELECT * FROM activity_logs {where} ORDER BY id DESC LIMIT ? OFFSET ?",
        [*params, per_page, offset],
    )
    return ok({"data": rows, "total": total_row["c"] if total_row else 0, "page": page, "per_page": per_page})


@app.get("/api/v1/settings")
def list_settings(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    prefix = _settings_key_prefix(user_id)

    scoped_rows = fetch_all("SELECT * FROM settings WHERE key LIKE ? ORDER BY key ASC", (f"{prefix}%",))
    global_rows = fetch_all("SELECT * FROM settings WHERE key NOT LIKE 'user:%' ORDER BY key ASC")

    by_key: dict[str, dict[str, Any]] = {}
    for row in global_rows:
        key = str(row.get("key") or "")
        row["value"] = json.loads(row.get("value") or "null")
        by_key[key] = row

    for row in scoped_rows:
        raw_key = str(row.get("key") or "")
        key = raw_key.replace(prefix, "", 1)
        row["key"] = key
        row["value"] = json.loads(row.get("value") or "null")
        by_key[key] = row

    rows = [by_key[k] for k in sorted(by_key.keys())]
    return ok(rows)


@app.put("/api/v1/settings")
def upsert_settings(payload: SettingsUpsertRequest, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    ts = now_iso()

    for item in payload.items:
        key = item.get("key")
        if not key:
            continue
        value = item.get("value")
        scoped_key = _settings_key(user_id, str(key))
        execute(
            """
            INSERT INTO settings(key, value, created_at, updated_at)
            VALUES(?,?,?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            """,
            (scoped_key, to_json(value), ts, ts),
        )

    rows = list_settings(user).get("data", [])
    return ok(rows, "Configuración guardada")


@app.get("/api/v1/system/status")
def get_system_status(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    user_id = int(user["id"])
    tools = system_status()

    return ok(
        {
            "python_version": platform.python_version(),
            "time": datetime.utcnow().isoformat() + "Z",
            "yt_dlp": tools["yt_dlp"],
            "ffmpeg": tools["ffmpeg"],
            "queue_pending": fetch_one(
                "SELECT COUNT(*) as c FROM downloads WHERE user_id = ? AND status IN ('queued','processing')",
                (user_id,),
            )["c"],
            "app_env": settings.app_env,
        }
    )


@app.post("/api/v1/system/youtube-cookies")
async def upload_youtube_cookies(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _assert_admin(user)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=422, detail="Archivo vacío")

    content = raw.decode("utf-8", errors="ignore")
    if "youtube.com" not in content or "\t" not in content:
        raise HTTPException(
            status_code=422,
            detail="Archivo de cookies inválido. Exporta cookies.txt en formato Netscape desde YouTube.",
        )

    cookies_path = Path(settings.data_dir) / "youtube.cookies.txt"
    cookies_path.parent.mkdir(parents=True, exist_ok=True)
    cookies_path.write_text(content, encoding="utf-8")

    return ok(
        {
            "path": str(cookies_path),
            "size": len(content.encode("utf-8")),
            "filename": file.filename,
        },
        "Cookies de YouTube guardadas",
    )


@app.delete("/api/v1/system/youtube-cookies")
def delete_youtube_cookies(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    _assert_admin(user)
    cookies_path = Path(settings.data_dir) / "youtube.cookies.txt"
    if cookies_path.exists():
        cookies_path.unlink()
    return ok({"path": str(cookies_path)}, "Cookies de YouTube eliminadas")
