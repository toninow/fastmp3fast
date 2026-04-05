from __future__ import annotations

import binascii
import hashlib
import json
import secrets
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from .config import settings


DB_PATH = Path(settings.data_dir) / "fastmp3fast.db"
_LOCK = threading.RLock()



def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


_CONN = _connect()



def now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"



def to_json(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=True)



def from_json(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return value



def init_db() -> None:
    with _LOCK:
        _CONN.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE,
                name TEXT,
                password_hash TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                is_admin INTEGER DEFAULT 0,
                last_login_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                token_hash TEXT UNIQUE NOT NULL,
                username TEXT NOT NULL,
                expires_at TEXT,
                created_at TEXT NOT NULL,
                last_used_at TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS downloads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                local_uid TEXT UNIQUE,
                remote_id TEXT,
                title TEXT NOT NULL,
                custom_name TEXT,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                source_url TEXT NOT NULL,
                uploader TEXT,
                duration_seconds INTEGER,
                format TEXT,
                size_bytes INTEGER,
                created_at TEXT NOT NULL,
                downloaded_at TEXT,
                media_path TEXT,
                thumbnail_path TEXT,
                collection_id TEXT,
                notes TEXT,
                subtitle_languages TEXT,
                favorite INTEGER DEFAULT 0,
                archived INTEGER DEFAULT 0,
                last_playback_position_seconds INTEGER DEFAULT 0,
                last_played_at TEXT,
                sync_status TEXT DEFAULT 'synced',
                error_message TEXT,
                file_exists INTEGER DEFAULT 0,
                metadata TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS download_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                download_id INTEGER NOT NULL,
                kind TEXT,
                path TEXT,
                mime TEXT,
                size_bytes INTEGER,
                duration_seconds INTEGER,
                exists_on_disk INTEGER DEFAULT 1,
                metadata TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(download_id) REFERENCES downloads(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS collections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                local_id TEXT UNIQUE,
                name TEXT NOT NULL,
                description TEXT,
                color TEXT,
                icon TEXT,
                is_system INTEGER DEFAULT 0,
                sort_order INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS collection_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                download_id INTEGER NOT NULL,
                position INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                UNIQUE(collection_id, download_id),
                FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE,
                FOREIGN KEY(download_id) REFERENCES downloads(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                color TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, name),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS download_tag (
                download_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY(download_id, tag_id),
                FOREIGN KEY(download_id) REFERENCES downloads(id) ON DELETE CASCADE,
                FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS subtitles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                download_id INTEGER NOT NULL,
                language TEXT,
                format TEXT,
                path TEXT,
                is_default INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY(download_id) REFERENCES downloads(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS playback_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                download_id INTEGER UNIQUE NOT NULL,
                position_seconds INTEGER DEFAULT 0,
                duration_seconds INTEGER DEFAULT 0,
                percent REAL DEFAULT 0,
                volume REAL DEFAULT 1,
                speed REAL DEFAULT 1,
                is_completed INTEGER DEFAULT 0,
                updated_from TEXT,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(download_id) REFERENCES downloads(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sync_operations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                local_id TEXT,
                operation TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_local_id TEXT,
                entity_remote_id INTEGER,
                payload TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                attempts INTEGER DEFAULT 0,
                last_error TEXT,
                synced_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                download_id INTEGER,
                event TEXT NOT NULL,
                description TEXT,
                context TEXT,
                is_offline_event INTEGER DEFAULT 0,
                occurred_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(download_id) REFERENCES downloads(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                value TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        _migrate_legacy_schema()
        _CONN.commit()


def _password_hash(password: str) -> str:
    iterations = 390_000
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return f"pbkdf2_sha256${iterations}${salt}${binascii.hexlify(digest).decode('ascii')}"


def _table_columns(table_name: str) -> set[str]:
    rows = _CONN.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {str(row["name"]) for row in rows}


def _has_column(table_name: str, column_name: str) -> bool:
    return column_name in _table_columns(table_name)


def _ensure_column(table_name: str, column_sql: str) -> None:
    column_name = column_sql.split()[0].strip()
    if not _has_column(table_name, column_name):
        _CONN.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_sql}")


def _tags_have_legacy_unique_name_constraint() -> bool:
    indexes = _CONN.execute("PRAGMA index_list(tags)").fetchall()
    for index in indexes:
        if int(index["unique"]) != 1:
            continue
        cols = _CONN.execute(f"PRAGMA index_info('{index['name']}')").fetchall()
        names = [str(col["name"]) for col in cols]
        if names == ["name"]:
            return True
    return False


def _download_tag_fk_points_to_legacy_tags() -> bool:
    rows = _CONN.execute("PRAGMA foreign_key_list(download_tag)").fetchall()
    for row in rows:
        if str(row["from"]) == "tag_id" and str(row["table"]) != "tags":
            return True
    return False


def _rebuild_download_tag_table() -> None:
    _CONN.execute("PRAGMA foreign_keys=OFF")
    _CONN.execute("ALTER TABLE download_tag RENAME TO download_tag_old")
    _CONN.executescript(
        """
        CREATE TABLE download_tag (
            download_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY(download_id, tag_id),
            FOREIGN KEY(download_id) REFERENCES downloads(id) ON DELETE CASCADE,
            FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );
        """
    )
    _CONN.execute(
        """
        INSERT OR IGNORE INTO download_tag(download_id, tag_id)
        SELECT dt.download_id, dt.tag_id
        FROM download_tag_old dt
        INNER JOIN downloads d ON d.id = dt.download_id
        INNER JOIN tags t ON t.id = dt.tag_id
        """
    )
    _CONN.execute("DROP TABLE download_tag_old")
    _CONN.execute("PRAGMA foreign_keys=ON")


def _seed_admin_user() -> int:
    ts = now_iso()
    username = settings.admin_user.strip() or "admin"
    email = (settings.admin_email or "").strip() or None

    row = fetch_one("SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1", (username, email))
    if row:
        # Keep env credentials authoritative so the admin login is always recoverable.
        execute(
            "UPDATE users SET is_admin = 1, is_active = 1, password_hash = ?, updated_at = ? WHERE id = ?",
            (_password_hash(settings.admin_password), ts, row["id"]),
        )
        return int(row["id"])

    cur = execute(
        """
        INSERT INTO users(username, email, name, password_hash, is_active, is_admin, created_at, updated_at)
        VALUES(?, ?, ?, ?, 1, 1, ?, ?)
        """,
        (username, email, username, _password_hash(settings.admin_password), ts, ts),
    )
    return int(cur.lastrowid)


def _migrate_legacy_schema() -> None:
    default_user_id = _seed_admin_user()

    _ensure_column("tokens", "user_id INTEGER")
    _ensure_column("downloads", "user_id INTEGER")
    _ensure_column("collections", "user_id INTEGER")
    _ensure_column("tags", "user_id INTEGER")
    _ensure_column("sync_operations", "user_id INTEGER")
    _ensure_column("activity_logs", "user_id INTEGER")

    _CONN.execute(
        """
        UPDATE tokens
        SET user_id = COALESCE(
            user_id,
            (SELECT u.id FROM users u WHERE u.username = tokens.username OR u.email = tokens.username LIMIT 1),
            ?
        )
        WHERE user_id IS NULL
        """,
        (default_user_id,),
    )
    _CONN.execute("UPDATE downloads SET user_id = ? WHERE user_id IS NULL", (default_user_id,))
    _CONN.execute("UPDATE collections SET user_id = ? WHERE user_id IS NULL", (default_user_id,))
    _CONN.execute("UPDATE tags SET user_id = ? WHERE user_id IS NULL", (default_user_id,))
    _CONN.execute("UPDATE sync_operations SET user_id = ? WHERE user_id IS NULL", (default_user_id,))
    _CONN.execute(
        "UPDATE activity_logs SET user_id = COALESCE(user_id, (SELECT user_id FROM downloads d WHERE d.id = activity_logs.download_id), ?) WHERE user_id IS NULL",
        (default_user_id,),
    )

    if _tags_have_legacy_unique_name_constraint():
        _CONN.execute("PRAGMA foreign_keys=OFF")
        _CONN.execute("ALTER TABLE tags RENAME TO tags_old")
        _CONN.executescript(
            """
            CREATE TABLE tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                color TEXT,
                created_at TEXT NOT NULL,
                UNIQUE(user_id, name),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )
        _CONN.execute(
            """
            INSERT INTO tags(id, user_id, name, color, created_at)
            SELECT id, COALESCE(user_id, ?), name, color, created_at
            FROM tags_old
            """,
            (default_user_id,),
        )
        _CONN.execute("DROP TABLE tags_old")
        _CONN.execute("PRAGMA foreign_keys=ON")

    if _download_tag_fk_points_to_legacy_tags():
        _rebuild_download_tag_table()

    _CONN.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_downloads_user_id ON downloads(user_id);
        CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
        CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id);
        CREATE INDEX IF NOT EXISTS idx_sync_operations_user_id ON sync_operations(user_id);
        CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
        """
    )



def execute(sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
    with _LOCK:
        cur = _CONN.execute(sql, tuple(params))
        _CONN.commit()
        return cur



def executemany(sql: str, seq_of_params: Iterable[Iterable[Any]]) -> None:
    with _LOCK:
        _CONN.executemany(sql, [tuple(p) for p in seq_of_params])
        _CONN.commit()



def fetch_one(sql: str, params: Iterable[Any] = ()) -> dict[str, Any] | None:
    with _LOCK:
        row = _CONN.execute(sql, tuple(params)).fetchone()
    return dict(row) if row else None



def fetch_all(sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
    with _LOCK:
        rows = _CONN.execute(sql, tuple(params)).fetchall()
    return [dict(row) for row in rows]


@contextmanager
def transaction() -> Any:
    with _LOCK:
        try:
            _CONN.execute("BEGIN")
            yield _CONN
            _CONN.commit()
        except Exception:
            _CONN.rollback()
            raise



def seed_defaults() -> None:
    ts = now_iso()
    defaults = [
        ("appearance", to_json({"theme": "fastmp3fast-dark-neon"}), ts, ts),
        (
            "download_defaults",
            to_json(
                {
                    "videoQuality": "1080p",
                    "audioQuality": "320kbps",
                    "subtitleLanguage": "es",
                    "saveThumbnail": True,
                    "saveMetadata": True,
                }
            ),
            ts,
            ts,
        ),
        (
            "player",
            to_json({"autoplay": False, "rememberVolume": True, "rememberProgress": True, "defaultSpeed": 1}),
            ts,
            ts,
        ),
        ("sync", to_json({"mode": "auto", "retryLimit": 5, "backgroundIntervalSeconds": 20}), ts, ts),
    ]
    with _LOCK:
        for key, value, created_at, updated_at in defaults:
            _CONN.execute(
                """
                INSERT INTO settings(key, value, created_at, updated_at)
                VALUES(?, ?, ?, ?)
                ON CONFLICT(key) DO NOTHING
                """,
                (key, value, created_at, updated_at),
            )
        _CONN.commit()


init_db()
seed_defaults()
