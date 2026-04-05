from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class Settings:
    app_name: str
    app_env: str
    app_host: str
    app_port: int
    app_secret: str
    admin_user: str
    admin_email: str
    admin_password: str
    token_ttl_hours: int
    yt_dlp_bin: str
    yt_dlp_cookies_file: Path | None
    yt_dlp_proxy: str | None
    yt_dlp_force_ipv4: bool
    yt_dlp_remote_components: str | None
    ffmpeg_bin: str
    data_dir: Path
    downloads_dir: Path
    subtitles_dir: Path



def _load_dotenv() -> None:
    base_dir = Path(__file__).resolve().parent.parent
    env_file = base_dir / ".env"
    if not env_file.exists():
        return

    for line in env_file.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'").strip('"'))



def _env(name: str, default: str) -> str:
    return os.getenv(name, default)


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}



def load_settings() -> Settings:
    _load_dotenv()
    base_dir = Path(__file__).resolve().parent.parent

    data_dir = Path(_env("DATA_DIR", str(base_dir / "data"))).resolve()
    downloads_dir = Path(_env("DOWNLOADS_DIR", str(data_dir / "downloads"))).resolve()
    subtitles_dir = Path(_env("SUBTITLES_DIR", str(data_dir / "subtitles"))).resolve()

    for directory in [data_dir, downloads_dir, subtitles_dir, data_dir / "tmp"]:
        directory.mkdir(parents=True, exist_ok=True)

    yt_bin = _env("YT_DLP_BIN", "yt-dlp")
    if shutil.which(yt_bin) is None:
        venv_yt = base_dir / ".venv" / "bin" / "yt-dlp"
        if venv_yt.exists():
            yt_bin = str(venv_yt)
    cookies_raw = _env("YT_DLP_COOKIES_FILE", "").strip()
    yt_cookies_file: Path | None = None
    if cookies_raw:
        cookies_path = Path(cookies_raw)
        if not cookies_path.is_absolute():
            cookies_path = (base_dir / cookies_path).resolve()
        yt_cookies_file = cookies_path
    yt_proxy = _env("YT_DLP_PROXY", "").strip() or None
    yt_remote_components = _env("YT_DLP_REMOTE_COMPONENTS", "ejs:github").strip() or None

    return Settings(
        app_name=_env("APP_NAME", "FASTMP3FAST Python API"),
        app_env=_env("APP_ENV", "development"),
        app_host=_env("APP_HOST", "127.0.0.1"),
        app_port=int(_env("APP_PORT", "8001")),
        app_secret=_env("APP_SECRET", "fastmp3fast-change-me"),
        admin_user=_env("ADMIN_USER", "admin"),
        admin_email=_env("ADMIN_EMAIL", "admin@fastmp3fast.local"),
        admin_password=_env("ADMIN_PASSWORD", "Fastmp3fast123!"),
        token_ttl_hours=int(_env("TOKEN_TTL_HOURS", "24")),
        yt_dlp_bin=yt_bin,
        yt_dlp_cookies_file=yt_cookies_file,
        yt_dlp_proxy=yt_proxy,
        yt_dlp_force_ipv4=_env_bool("YT_DLP_FORCE_IPV4", True),
        yt_dlp_remote_components=yt_remote_components,
        ffmpeg_bin=_env("FFMPEG_BIN", "ffmpeg"),
        data_dir=data_dir,
        downloads_dir=downloads_dir,
        subtitles_dir=subtitles_dir,
    )


settings = load_settings()
