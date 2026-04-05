from __future__ import annotations

import json
import queue
import re
import select
import shutil
import sqlite3
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .config import settings
from .db import execute, fetch_all, fetch_one, now_iso, to_json


MEDIA_EXTS = {"mp3", "m4a", "aac", "flac", "wav", "mp4", "mkv", "webm", "mov", "avi"}
PROGRESS_RE = re.compile(r"\[download\]\s+(?P<percent>\d+(?:\.\d+)?)%")
SPEED_RE = re.compile(r"\sat\s+(?P<speed>[0-9A-Za-z./~:]+)")
ETA_RE = re.compile(r"ETA\s+(?P<eta>[0-9:]+)")
ANTIBOT_MARKERS = (
    "Sign in to confirm you're not a bot",
    "Sign in to confirm you’re not a bot",
    "HTTP Error 429",
    "HTTP Error 503",
)
_IMPERSONATE_SUPPORT_CACHE: dict[str, bool] = {}
_REMOTE_COMPONENTS_SUPPORT_CACHE: bool | None = None


@dataclass
class CommandResult:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False


def _safe_json_loads(raw: str) -> Any:
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _payload_value(payload: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in payload and payload.get(key) is not None and payload.get(key) != "":
            return payload.get(key)
    return default


def _has_binary(binary: str) -> bool:
    return shutil.which(binary) is not None


def _append_ytdlp_network_options(command: list[str]) -> list[str]:
    if settings.yt_dlp_force_ipv4:
        command.append("--force-ipv4")

    if settings.yt_dlp_proxy:
        command.extend(["--proxy", settings.yt_dlp_proxy])

    cookies_file = _effective_cookies_file()
    if cookies_file and cookies_file.is_file():
        command.extend(["--cookies", str(cookies_file)])

    return command


def _effective_cookies_file() -> Path | None:
    configured = settings.yt_dlp_cookies_file
    if configured and configured.is_file():
        return configured

    fallback = Path(settings.data_dir) / "youtube.cookies.txt"
    if fallback.is_file():
        return fallback

    return None


def _resolve_ffmpeg_location() -> str | None:
    configured = str(settings.ffmpeg_bin or "").strip()
    if not configured:
        return None

    configured_path = Path(configured)
    if configured_path.is_absolute():
        if configured_path.is_file():
            return str(configured_path.parent)
        if configured_path.is_dir():
            return str(configured_path)

    discovered = shutil.which(configured)
    if discovered:
        return str(Path(discovered).parent)

    return None


def _supports_remote_components_option() -> bool:
    global _REMOTE_COMPONENTS_SUPPORT_CACHE

    if _REMOTE_COMPONENTS_SUPPORT_CACHE is not None:
        return _REMOTE_COMPONENTS_SUPPORT_CACHE

    if not _has_binary(settings.yt_dlp_bin):
        _REMOTE_COMPONENTS_SUPPORT_CACHE = False
        return False

    try:
        proc = subprocess.run(
            [settings.yt_dlp_bin, "--help"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        output = f"{proc.stdout}\n{proc.stderr}".lower()
        _REMOTE_COMPONENTS_SUPPORT_CACHE = "--remote-components" in output
    except Exception:
        _REMOTE_COMPONENTS_SUPPORT_CACHE = False

    return _REMOTE_COMPONENTS_SUPPORT_CACHE


def _default_youtube_player_client() -> str:
    # YouTube marks android client as incompatible with cookies.
    # If cookies are available, prioritize web clients to avoid ignored-cookie warnings.
    if _effective_cookies_file() is not None:
        return "web,mweb"
    return "android,web"


def _append_youtube_options(
    command: list[str],
    *,
    player_client: str | None = None,
    impersonate: str | None = "chrome",
) -> None:
    selected_client = (player_client or _default_youtube_player_client()).strip() or _default_youtube_player_client()
    command.extend(["--extractor-args", f"youtube:player_client={selected_client}"])

    if settings.yt_dlp_remote_components and _supports_remote_components_option():
        command.extend(["--remote-components", settings.yt_dlp_remote_components])

    if impersonate and _supports_impersonate_target(impersonate):
        command.extend(["--impersonate", impersonate])

    if _has_binary("node"):
        command.extend(["--js-runtimes", "node"])


def _supports_impersonate_target(target: str) -> bool:
    value = (target or "").strip()
    if not value:
        return False

    cache_key = value.lower()
    if cache_key in _IMPERSONATE_SUPPORT_CACHE:
        return _IMPERSONATE_SUPPORT_CACHE[cache_key]

    if not _has_binary(settings.yt_dlp_bin):
        _IMPERSONATE_SUPPORT_CACHE[cache_key] = False
        return False

    try:
        proc = subprocess.run(
            [settings.yt_dlp_bin, "--list-impersonate-targets"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
        output = f"{proc.stdout}\n{proc.stderr}"
        supported = False
        if proc.returncode == 0:
            output_lower = output.lower()
            value_lower = value.lower()
            if value_lower in output_lower:
                supported = True
            else:
                targets: set[str] = set()
                for raw_line in output.splitlines():
                    line = raw_line.strip()
                    if not line:
                        continue
                    lower = line.lower()
                    if lower.startswith("[info]") or lower.startswith("client") or set(line) <= {"-", " "}:
                        continue
                    first = line.split()[0].strip().lower()
                    if first:
                        targets.add(first)
                supported = value_lower in targets or any(token.startswith(f"{value_lower}-") for token in targets)
    except Exception:
        supported = False

    _IMPERSONATE_SUPPORT_CACHE[cache_key] = supported
    return supported


def system_status() -> dict[str, Any]:
    yt_available = _has_binary(settings.yt_dlp_bin)
    ffmpeg_available = _has_binary(settings.ffmpeg_bin)

    def _version(cmd: list[str]) -> str | None:
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=8, check=False)
            if result.returncode == 0:
                return (result.stdout or result.stderr).strip().splitlines()[0]
            return None
        except Exception:
            return None

    return {
        "yt_dlp": {
            "available": yt_available,
            "version": _version([settings.yt_dlp_bin, "--version"]) if yt_available else None,
            "cookies_configured": _effective_cookies_file() is not None,
            "cookies_path": str(_effective_cookies_file()) if _effective_cookies_file() else None,
        },
        "ffmpeg": {
            "available": ffmpeg_available,
            "version": _version([settings.ffmpeg_bin, "-version"]) if ffmpeg_available else None,
        },
    }


def probe_formats(url: str) -> dict[str, Any]:
    if not _has_binary(settings.yt_dlp_bin):
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Binary not found: {settings.yt_dlp_bin}",
            "video_qualities": [],
            "audio_bitrates_kbps": [],
            "max_video_height": None,
            "has_2k": False,
            "has_4k": False,
        }

    command = [
        settings.yt_dlp_bin,
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
    ]
    _append_ytdlp_network_options(command)
    if _is_youtube_url(url):
        command.extend(["--extractor-args", "youtube:player_client=android,web"])
        if _supports_impersonate_target("chrome"):
            command.extend(["--impersonate", "chrome"])
        if _has_binary("node"):
            command.extend(["--js-runtimes", "node"])
    command.append(url)

    proc = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    parsed_json: dict[str, Any] = {}
    if proc.returncode == 0:
        try:
            payload = json.loads(proc.stdout or "{}")
            if isinstance(payload, dict):
                parsed_json = payload
        except Exception:
            parsed_json = {}

    if parsed_json:
        video_heights: set[int] = set()
        audio_bitrates: set[int] = set()

        for fmt in parsed_json.get("formats") or []:
            if not isinstance(fmt, dict):
                continue

            vcodec = str(fmt.get("vcodec") or "").lower()
            acodec = str(fmt.get("acodec") or "").lower()
            height_value = _safe_int(fmt.get("height"), 0)
            abr_value = _safe_int(fmt.get("abr"), 0)
            tbr_value = _safe_int(fmt.get("tbr"), 0)

            if vcodec and vcodec != "none" and height_value > 0:
                video_heights.add(height_value)

            if acodec and acodec != "none":
                bitrate = abr_value if abr_value > 0 else tbr_value
                if bitrate > 0:
                    audio_bitrates.add(bitrate)

        video_qualities = [f"{height}p" for height in sorted(video_heights, reverse=True)]
        max_video_height = max(video_heights) if video_heights else None

        return {
            "success": True,
            "stdout": "",
            "stderr": proc.stderr,
            "video_qualities": video_qualities,
            "audio_bitrates_kbps": sorted(audio_bitrates, reverse=True),
            "max_video_height": max_video_height,
            "has_2k": 1440 in video_heights,
            "has_4k": any(height >= 2160 for height in video_heights),
        }

    legacy_command = [settings.yt_dlp_bin, "-F", url]
    _append_ytdlp_network_options(legacy_command)
    legacy_proc = subprocess.run(
        legacy_command,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )

    return {
        "success": legacy_proc.returncode == 0,
        "stdout": legacy_proc.stdout,
        "stderr": legacy_proc.stderr,
        "video_qualities": [],
        "audio_bitrates_kbps": [],
        "max_video_height": None,
        "has_2k": False,
        "has_4k": False,
    }


def _run_ytdlp_json_lines(command: list[str], timeout: int = 120) -> tuple[bool, list[dict[str, Any]], str]:
    if not _has_binary(settings.yt_dlp_bin):
        return False, [], f"Binary not found: {settings.yt_dlp_bin}"

    proc = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    rows: list[dict[str, Any]] = []
    for line in (proc.stdout or "").splitlines():
        raw = line.strip()
        if not raw:
            continue
        try:
            payload = json.loads(raw)
            if isinstance(payload, dict):
                rows.append(payload)
        except Exception:
            continue

    return proc.returncode == 0, rows, proc.stderr or ""


def youtube_search(query: str, limit: int = 10) -> dict[str, Any]:
    q = query.strip()
    if not q:
        return {"success": False, "results": [], "error": "q is required"}

    lim = max(1, min(limit, 25))
    command = [
        settings.yt_dlp_bin,
        "--dump-json",
        "--skip-download",
        "--flat-playlist",
        "--no-warnings",
        "--extractor-args",
        "youtube:player_client=android,web",
        "--playlist-end",
        str(lim),
        f"ytsearch{lim}:{q}",
    ]
    _append_ytdlp_network_options(command)
    if _supports_impersonate_target("chrome"):
        command.extend(["--impersonate", "chrome"])
    if _has_binary("node"):
        command.extend(["--js-runtimes", "node"])

    success, rows, stderr = _run_ytdlp_json_lines(command, timeout=90)
    results: list[dict[str, Any]] = []
    for item in rows:
        video_id = str(item.get("id") or "").strip()
        webpage_url = str(item.get("webpage_url") or "") or (f"https://www.youtube.com/watch?v={video_id}" if video_id else "")
        duration = _safe_int(item.get("duration"), 0)
        results.append(
            {
                "id": video_id or None,
                "title": item.get("title") or "Sin título",
                "uploader": item.get("uploader") or item.get("channel") or "",
                "duration_seconds": duration if duration > 0 else None,
                "webpage_url": webpage_url,
                "thumbnail": item.get("thumbnail"),
            }
        )

    return {
        "success": success,
        "query": q,
        "count": len(results),
        "results": results,
        "error": stderr[-1000:] if stderr else None,
    }


def _tokenize(text: str) -> list[str]:
    raw = re.findall(r"[a-zA-Z0-9]{3,}", (text or "").lower())
    stop = {
        "the",
        "and",
        "with",
        "from",
        "para",
        "con",
        "como",
        "que",
        "video",
        "audio",
        "music",
        "official",
        "lyrics",
        "topic",
    }
    return [x for x in raw if x not in stop][:6]


def recommendations(user_id: int, limit: int = 12) -> dict[str, Any]:
    lim = max(1, min(limit, 30))
    user_downloads = fetch_all(
        """
        SELECT id, title, custom_name, source_url, uploader, tags_csv
        FROM (
            SELECT
                d.id,
                d.title,
                d.custom_name,
                d.source_url,
                d.uploader,
                (
                    SELECT GROUP_CONCAT(t.name, ',')
                    FROM download_tag dt
                    INNER JOIN tags t ON t.id = dt.tag_id
                    WHERE dt.download_id = d.id AND t.user_id = d.user_id
                ) as tags_csv
            FROM downloads d
            WHERE d.user_id = ? AND d.status IN ('completed','playing','paused')
            ORDER BY d.last_played_at DESC, d.downloaded_at DESC, d.id DESC
            LIMIT 80
        )
        """,
        (user_id,),
    )

    if not user_downloads:
        return {"success": True, "mode": "empty_history", "results": []}

    downloaded_urls = {str(row.get("source_url") or "") for row in user_downloads if row.get("source_url")}

    scores: dict[str, int] = {}
    for row in user_downloads:
        for tag in str(row.get("tags_csv") or "").split(","):
            t = tag.strip().lower()
            if len(t) >= 3:
                scores[t] = scores.get(t, 0) + 3

        for token in _tokenize(str(row.get("custom_name") or row.get("title") or "")):
            scores[token] = scores.get(token, 0) + 1

        uploader = str(row.get("uploader") or "").strip().lower()
        if len(uploader) >= 3:
            scores[uploader] = scores.get(uploader, 0) + 2

    top_keywords = [k for k, _ in sorted(scores.items(), key=lambda x: x[1], reverse=True)[:5]]
    if not top_keywords:
        top_keywords = ["music", "mix", "video"]

    aggregate: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for keyword in top_keywords[:3]:
        search = youtube_search(keyword, limit=6)
        for result in search.get("results", []):
            url = str(result.get("webpage_url") or "").strip()
            if not url or url in seen_urls or url in downloaded_urls:
                continue
            seen_urls.add(url)
            aggregate.append(
                {
                    **result,
                    "reason": f"Basado en: {keyword}",
                }
            )
            if len(aggregate) >= lim:
                break
        if len(aggregate) >= lim:
            break

    if aggregate:
        return {"success": True, "mode": "youtube", "results": aggregate[:lim], "keywords": top_keywords[:3]}

    local_fallback = []
    for row in user_downloads[:lim]:
        local_fallback.append(
            {
                "id": f"local-{row['id']}",
                "title": row.get("custom_name") or row.get("title") or "Sin título",
                "uploader": row.get("uploader") or "",
                "duration_seconds": None,
                "webpage_url": row.get("source_url") or "",
                "thumbnail": None,
                "reason": "Basado en tu historial reciente",
            }
        )

    return {"success": True, "mode": "local_history", "results": local_fallback}


def _srt_to_vtt_content(srt_text: str) -> str:
    lines = ["WEBVTT", ""]
    for raw in srt_text.splitlines():
        line = raw.strip("\ufeff")
        if line.isdigit():
            continue
        lines.append(line.replace(",", ".") if "-->" in line else line)
    return "\n".join(lines).strip() + "\n"


def _video_height_from_quality(value: Any) -> int | None:
    if value is None:
        return None

    raw = str(value).lower().strip()
    for token in ("4320", "2160", "1440", "1080", "720", "480", "360", "240"):
        if token in raw:
            return int(token)
    return None


def _audio_quality_for_ytdlp(value: Any) -> str:
    if value is None:
        return "0"

    raw = str(value).lower().strip()
    if "best" in raw or "max" in raw:
        return "0"
    if "320" in raw:
        return "0"
    if "256" in raw:
        return "1"
    if "192" in raw:
        return "3"
    if "160" in raw:
        return "4"
    if "128" in raw:
        return "5"
    return "0"


def _normalize_download_type(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return "audio_mp3"
    if raw in {"audio_mp3", "video_mp4"}:
        return raw
    if "mp3" in raw or "audio" in raw:
        return "audio_mp3"
    if "mp4" in raw or "video" in raw:
        return "video_mp4"
    return "audio_mp3"


def _preferred_media_extension_for_type(type_name: Any) -> str:
    normalized = _normalize_download_type(type_name)
    return "mp3" if normalized == "audio_mp3" else "mp4"


def _canonical_source_url(url: str) -> str:
    value = str(url or "").strip()
    if not value:
        return value

    try:
        parsed = urlparse(value)
        host = (parsed.netloc or "").lower()

        if "youtu.be" in host:
            video_id = parsed.path.strip("/")
            if video_id:
                return f"https://www.youtube.com/watch?v={video_id}"

        if "youtube.com" in host:
            query = parse_qs(parsed.query)
            video_id = (query.get("v") or [""])[0].strip()
            if video_id:
                return f"https://www.youtube.com/watch?v={video_id}"
    except Exception:
        return value.rstrip("/")

    return value.rstrip("/")


def _is_youtube_url(url: str) -> bool:
    try:
        host = (urlparse(str(url or "")).netloc or "").lower()
    except Exception:
        host = str(url or "").lower()
    return ("youtube.com" in host) or ("youtu.be" in host)


def _contains_antibot_signal(text: str | None) -> bool:
    raw = str(text or "")
    return any(marker in raw for marker in ANTIBOT_MARKERS)


def _find_duplicate_download(
    user_id: int,
    source_url: str,
    local_uid: str,
    requested_type: str | None = None,
    requested_video_quality: str | None = None,
    requested_audio_quality: str | None = None,
) -> dict[str, Any] | None:
    normalized = _canonical_source_url(source_url)
    if not normalized:
        return None
    requested_type_norm = str(requested_type or "").strip().lower()
    requested_video_quality_norm = str(requested_video_quality or "").strip().lower()
    requested_audio_quality_norm = str(requested_audio_quality or "").strip().lower()

    rows = fetch_all(
        """
        SELECT *
        FROM downloads
        WHERE user_id = ?
          AND local_uid != ?
          AND status IN ('queued','processing','completed','pending','offline','playing','paused')
        ORDER BY id DESC
        LIMIT 500
        """,
        (user_id, local_uid),
    )

    for row in rows:
        existing_url = str(row.get("source_url") or "").strip()
        if not existing_url:
            continue
        status = str(row.get("status") or "").lower()
        if status in {"completed", "playing", "paused"}:
            media_path = str(row.get("media_path") or "").strip()
            media_exists = bool(media_path) and Path(media_path).is_file()
            if not media_exists:
                execute(
                    "UPDATE downloads SET file_exists = 0, status = 'error', sync_status = 'sync_error', error_message = ? WHERE id = ?",
                    ("Archivo no encontrado en disco; reintenta la descarga.", int(row["id"])),
                )
                continue
        if _canonical_source_url(existing_url) == normalized:
            existing_type_norm = str(row.get("type") or "").strip().lower()
            if requested_type_norm and existing_type_norm and existing_type_norm != requested_type_norm:
                # Same URL can coexist in different requested output types (e.g. mp3 vs mp4).
                continue

            existing_meta = _safe_json_loads(str(row.get("metadata") or "{}"))
            if not isinstance(existing_meta, dict):
                existing_meta = {}

            existing_video_quality_norm = str(existing_meta.get("video_quality") or "").strip().lower()
            existing_audio_quality_norm = str(existing_meta.get("audio_quality") or "").strip().lower()

            if "video" in requested_type_norm or "mp4" in requested_type_norm:
                if requested_video_quality_norm and requested_video_quality_norm != existing_video_quality_norm:
                    # Allow another entry when user asks for a different video quality.
                    continue
            if "audio" in requested_type_norm or requested_type_norm.endswith("mp3"):
                if requested_audio_quality_norm and requested_audio_quality_norm != existing_audio_quality_norm:
                    # Allow another entry when user asks for a different audio quality.
                    continue
            duplicate = dict(row)
            duplicate["already_exists"] = True
            duplicate["duplicate_of_id"] = row.get("id")
            duplicate["normalized_source_url"] = normalized
            return duplicate
    return None


def _extract_progress(line: str) -> tuple[float | None, str | None, str | None]:
    percent_match = PROGRESS_RE.search(line)
    if not percent_match:
        return None, None, None

    percent_raw = percent_match.group("percent")
    try:
        percent = max(0.0, min(100.0, float(percent_raw)))
    except Exception:
        percent = None

    speed_match = SPEED_RE.search(line)
    eta_match = ETA_RE.search(line)
    speed = speed_match.group("speed") if speed_match else None
    eta = eta_match.group("eta") if eta_match else None
    return percent, speed, eta


def _persist_progress_metadata(
    download_id: int,
    metadata: dict[str, Any],
    *,
    percent: float | None = None,
    speed: str | None = None,
    eta: str | None = None,
    line: str | None = None,
    state: str | None = None,
) -> dict[str, Any]:
    current = dict(metadata or {})
    if percent is not None:
        current["progress_percent"] = round(float(percent), 2)
    if speed is not None:
        current["progress_speed"] = speed
    if eta is not None:
        current["progress_eta"] = eta
    if line is not None:
        current["progress_line"] = line[-220:]
    if state is not None:
        current["progress_state"] = state
    current["progress_updated_at"] = now_iso()

    execute("UPDATE downloads SET metadata = ? WHERE id = ?", (to_json(current), download_id))
    return current


def _run_download_with_progress(
    download_id: int,
    command: list[str],
    metadata: dict[str, Any],
    timeout: int = 1800,
) -> tuple[CommandResult, dict[str, Any]]:
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    if process.stdout is None:
        result = CommandResult(returncode=1, stdout="", stderr="yt-dlp stdout unavailable")
        return result, metadata

    started_at = time.monotonic()
    chunks: list[str] = []
    chunks_size = 0
    max_buffer = 120000
    timed_out = False
    last_emit = 0.0
    last_percent = -1.0
    progress_meta = dict(metadata or {})

    while True:
        if (time.monotonic() - started_at) > timeout:
            timed_out = True
            process.kill()
            break

        ready, _, _ = select.select([process.stdout], [], [], 0.35)
        if ready:
            line = process.stdout.readline()
            if line:
                raw = line.rstrip("\n")
                chunks.append(raw)
                chunks_size += len(raw) + 1
                while chunks_size > max_buffer and chunks:
                    dropped = chunks.pop(0)
                    chunks_size -= len(dropped) + 1

                percent, speed, eta = _extract_progress(raw)
                if percent is not None:
                    now_tick = time.monotonic()
                    should_emit = (
                        percent >= 100
                        or (percent - last_percent) >= 0.5
                        or (now_tick - last_emit) >= 1.2
                    )
                    if should_emit:
                        last_emit = now_tick
                        last_percent = percent
                        progress_meta = _persist_progress_metadata(
                            download_id,
                            progress_meta,
                            percent=percent,
                            speed=speed,
                            eta=eta,
                            line=raw,
                            state="processing",
                        )
            elif process.poll() is not None:
                break
        elif process.poll() is not None:
            break

    if timed_out:
        return CommandResult(returncode=1, stdout="\n".join(chunks), stderr="Timeout", timed_out=True), progress_meta

    returncode = process.wait()
    output = "\n".join(chunks)
    return CommandResult(returncode=returncode, stdout=output, stderr=output, timed_out=False), progress_meta


def _build_download_command(
    download: dict[str, Any],
    metadata: dict[str, Any],
    subtitle_languages: list[str],
    *,
    player_client: str | None = None,
    impersonate: str | None = "chrome",
) -> tuple[list[str], list[str]]:
    command = [
        settings.yt_dlp_bin,
        "--newline",
        "--restrict-filenames",
        "--extractor-retries",
        "3",
        "--retries",
        "8",
        "--fragment-retries",
        "8",
    ]
    _append_ytdlp_network_options(command)
    source_url = str(download.get("source_url") or "")
    youtube_source = _is_youtube_url(source_url)
    if youtube_source:
        _append_youtube_options(command, player_client=player_client, impersonate=impersonate)
    warnings: list[str] = []

    type_name = _normalize_download_type(download.get("type"))
    ffmpeg_available = _has_binary(settings.ffmpeg_bin)
    ffmpeg_location = _resolve_ffmpeg_location() if ffmpeg_available else None
    if ffmpeg_location:
        command.extend(["--ffmpeg-location", ffmpeg_location])
    video_height = _video_height_from_quality(metadata.get("video_quality"))
    audio_quality = _audio_quality_for_ytdlp(metadata.get("audio_quality"))

    if type_name == "audio_mp3":
        if ffmpeg_available:
            command.extend(["-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", audio_quality])
        else:
            command.extend(["-f", "bestaudio/best"])
            warnings.append("ffmpeg no disponible: se guardó audio original sin convertir a mp3.")
    elif type_name == "video_mp4":
        if ffmpeg_available:
            if video_height:
                format_expr = (
                    f"bestvideo*[height<={video_height}]+bestaudio/"
                    f"best[height<={video_height}]/best"
                )
            else:
                format_expr = "bestvideo*+bestaudio/best"
            command.extend(["-f", format_expr, "--merge-output-format", "mp4"])
        else:
            if video_height:
                format_expr = f"best[height<={video_height}]/best"
            else:
                format_expr = "best"
            command.extend(["-f", format_expr])
            warnings.append("ffmpeg no disponible: se descargó formato progresivo mp4 sin mezcla avanzada.")

    if subtitle_languages:
        command.extend(["--write-subs", "--write-auto-subs", "--sub-langs", ",".join(subtitle_languages)])

    if bool(metadata.get("save_thumbnail", True)):
        command.append("--write-thumbnail")

    if bool(metadata.get("save_metadata", True)):
        command.append("--write-info-json")

    return command, warnings


def _upsert_tags(download_id: int, user_id: int, tags: list[str]) -> None:
    execute("DELETE FROM download_tag WHERE download_id = ?", (download_id,))
    ts = now_iso()
    for tag in [x.strip() for x in tags if x.strip()]:
        existing = fetch_one("SELECT id FROM tags WHERE user_id = ? AND name = ?", (user_id, tag))
        if existing:
            tag_id = existing["id"]
        else:
            tag_id = execute(
                "INSERT INTO tags(user_id, name, color, created_at) VALUES (?, ?, ?, ?)",
                (user_id, tag, "#F7E733", ts),
            ).lastrowid
        execute("INSERT OR IGNORE INTO download_tag(download_id, tag_id) VALUES(?, ?)", (download_id, tag_id))


def _log_activity(
    user_id: int,
    download_id: int | None,
    event: str,
    description: str,
    context: dict[str, Any] | None = None,
) -> None:
    ts = now_iso()
    execute(
        """
        INSERT INTO activity_logs(user_id, download_id, event, description, context, is_offline_event, occurred_at, created_at)
        VALUES(?, ?, ?, ?, ?, 0, ?, ?)
        """,
        (user_id, download_id, event, description, to_json(context), ts, ts),
    )


def _find_media_file(directory: Path, preferred_ext: str | None = None) -> Path | None:
    candidates: list[Path] = []
    for path in directory.glob("*"):
        if path.is_file() and path.suffix.lower().lstrip(".") in MEDIA_EXTS:
            candidates.append(path)
    if not candidates:
        return None
    if preferred_ext:
        preferred = [path for path in candidates if path.suffix.lower().lstrip(".") == preferred_ext.lower().lstrip(".")]
        if preferred:
            preferred.sort(key=lambda x: x.stat().st_mtime, reverse=True)
            return preferred[0]
    candidates.sort(key=lambda x: x.stat().st_mtime, reverse=True)
    return candidates[0]


def _sync_subtitles(download_id: int, directory: Path) -> list[str]:
    execute("DELETE FROM subtitles WHERE download_id = ?", (download_id,))
    langs: list[str] = []

    for sub in sorted(directory.glob("*.srt")) + sorted(directory.glob("*.vtt")):
        fmt = sub.suffix.lower().lstrip(".")
        target = sub

        if fmt == "srt":
            vtt_target = Path(settings.subtitles_dir) / f"{sub.stem}.vtt"
            try:
                vtt_target.write_text(_srt_to_vtt_content(sub.read_text(encoding="utf-8", errors="ignore")), encoding="utf-8")
                target = vtt_target
                fmt = "vtt"
            except Exception:
                target = sub

        lang = "es"
        name = sub.stem.lower()
        if ".en" in name or "_en" in name or "-en" in name:
            lang = "en"
        elif ".fr" in name or "_fr" in name or "-fr" in name:
            lang = "fr"

        execute(
            """
            INSERT INTO subtitles(download_id, language, format, path, is_default, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (download_id, lang, fmt, str(target), 1 if lang == "es" else 0, now_iso()),
        )
        langs.append(lang)

    return sorted(list(set(langs)))


class DownloadWorker:
    def __init__(self) -> None:
        self._queue: queue.Queue[int] = queue.Queue()
        self._thread: threading.Thread | None = None
        self._started = False

    def start(self) -> None:
        if self._started:
            return
        self._started = True
        self._thread = threading.Thread(target=self._run, daemon=True, name="fastmp3fast-download-worker")
        self._thread.start()

    def enqueue(self, download_id: int) -> None:
        self.start()
        self._queue.put(download_id)

    def _run(self) -> None:
        while True:
            download_id = self._queue.get()
            try:
                self.process(download_id)
            except Exception as exc:
                execute(
                    "UPDATE downloads SET status = 'error', error_message = ? WHERE id = ?",
                    (f"Worker error: {exc}", download_id),
                )
                row = fetch_one("SELECT user_id FROM downloads WHERE id = ?", (download_id,))
                if row and row.get("user_id"):
                    _log_activity(int(row["user_id"]), download_id, "download_failed", "Worker failed unexpectedly", {"error": str(exc)})
            finally:
                self._queue.task_done()

    def process(self, download_id: int) -> None:
        download = fetch_one("SELECT * FROM downloads WHERE id = ?", (download_id,))
        if not download:
            return

        if not _has_binary(settings.yt_dlp_bin):
            execute(
                "UPDATE downloads SET status = 'error', error_message = ? WHERE id = ?",
                (f"yt-dlp not found in PATH ({settings.yt_dlp_bin})", download_id),
            )
            _log_activity(int(download["user_id"]), download_id, "download_failed", "yt-dlp binary not found", {"binary": settings.yt_dlp_bin})
            return

        execute(
            "UPDATE downloads SET status = 'processing', sync_status = 'syncing', error_message = NULL WHERE id = ?",
            (download_id,),
        )
        _log_activity(int(download["user_id"]), download_id, "download_processing", "Processing started")

        output_dir = Path(settings.downloads_dir) / str(download_id)
        output_dir.mkdir(parents=True, exist_ok=True)

        download_meta = _safe_json_loads(download.get("metadata") or "{}")
        if not isinstance(download_meta, dict):
            download_meta = {}
        download_meta = _persist_progress_metadata(
            download_id,
            download_meta,
            percent=0.0,
            line="Iniciando descarga",
            state="processing",
        )

        metadata_cmd = [
            settings.yt_dlp_bin,
            "--dump-single-json",
            "--skip-download",
        ]
        _append_ytdlp_network_options(metadata_cmd)
        if _is_youtube_url(str(download.get("source_url") or "")):
            _append_youtube_options(metadata_cmd, player_client=None, impersonate="chrome")
        metadata_cmd.append(download["source_url"])
        metadata_result = subprocess.run(metadata_cmd, capture_output=True, text=True, timeout=120, check=False)
        extracted_metadata = _safe_json_loads(metadata_result.stdout) if metadata_result.returncode == 0 else {}
        if not isinstance(extracted_metadata, dict):
            extracted_metadata = {}

        subtitle_languages_raw = _safe_json_loads(download.get("subtitle_languages") or "[]")
        subtitle_languages = subtitle_languages_raw if isinstance(subtitle_languages_raw, list) else []

        command, warnings = _build_download_command(download, download_meta, subtitle_languages)
        command.extend(["-P", str(output_dir), "-o", "%(title)s.%(ext)s", download["source_url"]])

        result, download_meta = _run_download_with_progress(download_id, command, download_meta, timeout=1800)
        if result.timed_out:
            execute(
                "UPDATE downloads SET status = 'error', error_message = ?, sync_status = 'sync_error' WHERE id = ?",
                ("Download timeout after 1800 seconds", download_id),
            )
            _log_activity(int(download["user_id"]), download_id, "download_failed", "yt-dlp timeout", {"timeout_seconds": 1800})
            return

        if result.returncode != 0:
            stderr_tail = result.stderr[-2000:]

            # Some providers throttle subtitle endpoints (e.g. HTTP 429). Retry media without subtitles.
            if subtitle_languages and (
                "Unable to download video subtitles" in result.stderr
                or "There are no subtitles" in result.stderr
                or "HTTP Error 429" in result.stderr
            ):
                retry_command, retry_warnings = _build_download_command(download, download_meta, [])
                retry_command.extend(["-P", str(output_dir), "-o", "%(title)s.%(ext)s", download["source_url"]])
                warnings.extend(retry_warnings)
                warnings.append("Subtítulos no disponibles o limitados por proveedor; se descargó el medio sin subtítulos.")
                retry_result, download_meta = _run_download_with_progress(download_id, retry_command, download_meta, timeout=1800)
                if not retry_result.timed_out and retry_result.returncode == 0:
                    result = retry_result
                else:
                    stderr_tail = retry_result.stderr[-2000:] if retry_result else "Retry timeout after subtitle failure"

            if result.returncode != 0 and _contains_antibot_signal(result.stderr):
                cookies_loaded = _effective_cookies_file() is not None
                fallback_profiles: list[tuple[str, str | None]] = (
                    [
                        ("web,mweb", "chrome"),
                        ("web", "chrome"),
                        ("mweb", "chrome"),
                    ]
                    if cookies_loaded
                    else [
                        ("android", "chrome"),
                        ("mweb,android", "chrome"),
                        ("web", "chrome"),
                    ]
                )
                for idx, (profile_client, profile_impersonate) in enumerate(fallback_profiles, start=1):
                    retry_command, retry_warnings = _build_download_command(
                        download,
                        download_meta,
                        subtitle_languages,
                        player_client=profile_client,
                        impersonate=profile_impersonate,
                    )
                    retry_command.extend(["-P", str(output_dir), "-o", "%(title)s.%(ext)s", download["source_url"]])
                    warnings.extend(retry_warnings)
                    warnings.append(
                        f"Reintento anti-bot #{idx}: client={profile_client}, impersonate={profile_impersonate or 'none'}."
                    )
                    antibot_result, download_meta = _run_download_with_progress(download_id, retry_command, download_meta, timeout=1800)
                    if not antibot_result.timed_out and antibot_result.returncode == 0:
                        result = antibot_result
                        break
                    stderr_tail = antibot_result.stderr[-2000:] if antibot_result else "Retry timeout after anti-bot fallback"

            if result.returncode != 0:
                if _contains_antibot_signal(stderr_tail):
                    cookies_file = _effective_cookies_file()
                    cookies_hint = (
                        " Sube un archivo cookies.txt válido de YouTube en Configuración del sistema o define YT_DLP_COOKIES_FILE."
                        if cookies_file is None
                        else ""
                    )
                    stderr_tail = (
                        "YouTube bloqueó temporalmente esta descarga desde el servidor (anti-bot). "
                        f"Prueba otro enlace o reintenta en unos minutos.{cookies_hint}\n\n"
                        f"Detalle técnico:\n{stderr_tail[-1400:]}"
                    )
                download_meta = _persist_progress_metadata(
                    download_id,
                    download_meta,
                    line="Bloqueado por YouTube (anti-bot)" if _contains_antibot_signal(stderr_tail) else "Error al descargar",
                    state="blocked_youtube" if _contains_antibot_signal(stderr_tail) else "error",
                )
                execute(
                    "UPDATE downloads SET status = 'error', error_message = ?, sync_status = 'sync_error' WHERE id = ?",
                    (stderr_tail, download_id),
                )
                _log_activity(
                    int(download["user_id"]),
                    download_id,
                    "download_failed",
                    "yt-dlp command failed",
                    {"stderr": stderr_tail, "stdout": result.stdout[-1000:]},
                )
                return

        preferred_ext = _preferred_media_extension_for_type(download.get("type"))
        media_file = _find_media_file(output_dir, preferred_ext=preferred_ext)
        subtitle_langs = _sync_subtitles(download_id, output_dir)

        uploader = extracted_metadata.get("uploader")
        title = extracted_metadata.get("title") or download.get("custom_name") or download.get("title")
        duration = extracted_metadata.get("duration")

        if not media_file:
            download_meta = _persist_progress_metadata(
                download_id,
                download_meta,
                line="Descarga sin archivo final",
                state="error",
            )
            execute(
                "UPDATE downloads SET status = 'error', error_message = ?, sync_status = 'sync_error' WHERE id = ?",
                ("Download finished but media file not found", download_id),
            )
            _log_activity(int(download["user_id"]), download_id, "download_failed", "No media file detected after download")
            return

        stat = media_file.stat()
        unique_warnings = list(dict.fromkeys(warnings))
        media_ext = media_file.suffix.lower().lstrip(".")
        if preferred_ext and media_ext != preferred_ext:
            unique_warnings.append(
                f"Formato final detectado: {media_ext}; tipo solicitado: {download.get('type')}. "
                f"Se esperaba {preferred_ext}."
            )

        requested_video_height = _video_height_from_quality(download_meta.get("video_quality"))
        actual_video_height = _safe_int(extracted_metadata.get("height"), 0)
        if requested_video_height and actual_video_height and actual_video_height < requested_video_height:
            unique_warnings.append(
                f"Calidad solicitada: {requested_video_height}p; calidad entregada por origen: {actual_video_height}p."
            )

        requested_audio_quality = str(download_meta.get("audio_quality") or "").lower()
        actual_abr = _safe_int(extracted_metadata.get("abr"), 0)
        if "320" in requested_audio_quality and actual_abr and actual_abr < 300:
            unique_warnings.append(
                f"Calidad solicitada: 320kbps; bitrate entregado por origen: {actual_abr}kbps."
            )

        final_metadata = dict(download_meta)
        final_metadata.update(extracted_metadata)
        final_metadata["progress_percent"] = 100.0
        final_metadata["progress_state"] = "completed"
        final_metadata["progress_line"] = "Descarga completada"
        final_metadata["progress_speed"] = None
        final_metadata["progress_eta"] = None
        final_metadata["progress_updated_at"] = now_iso()
        if actual_video_height:
            final_metadata["actual_video_height"] = actual_video_height
        if actual_abr:
            final_metadata["actual_audio_bitrate_kbps"] = actual_abr

        execute(
            """
            UPDATE downloads
            SET
                title = ?,
                uploader = ?,
                duration_seconds = ?,
                format = ?,
                size_bytes = ?,
                downloaded_at = ?,
                media_path = ?,
                file_exists = 1,
                status = 'completed',
                sync_status = 'synced',
                subtitle_languages = ?,
                error_message = ?,
                metadata = ?
            WHERE id = ?
            """,
            (
                title,
                uploader,
                duration,
                media_ext,
                stat.st_size,
                now_iso(),
                str(media_file),
                to_json(subtitle_langs),
                "; ".join(unique_warnings) if unique_warnings else None,
                to_json(final_metadata),
                download_id,
            ),
        )

        execute("DELETE FROM download_files WHERE download_id = ?", (download_id,))
        execute(
            """
            INSERT INTO download_files(download_id, kind, path, mime, size_bytes, duration_seconds, exists_on_disk, metadata, created_at)
            VALUES(?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                download_id,
                "media",
                str(media_file),
                None,
                stat.st_size,
                duration,
                to_json({"source": "yt-dlp"}),
                now_iso(),
            ),
        )

        _log_activity(
            int(download["user_id"]),
            download_id,
            "download_completed",
            "Download completed successfully",
            {"file": str(media_file), "size": stat.st_size, "warnings": unique_warnings},
        )


worker = DownloadWorker()


def enqueue_download(download_id: int) -> None:
    worker.enqueue(download_id)


def list_pending_sync(user_id: int) -> list[dict[str, Any]]:
    return fetch_all(
        "SELECT * FROM sync_operations WHERE user_id = ? AND status IN ('pending','error') ORDER BY id DESC LIMIT 100",
        (user_id,),
    )


def hydrate_download_tags(rows: list[dict[str, Any]], user_id: int | None = None) -> list[dict[str, Any]]:
    if not rows:
        return rows

    for row in rows:
        row_user_id = int(row.get("user_id") or user_id or 0)
        tags = fetch_all(
            """
            SELECT t.name FROM tags t
            INNER JOIN download_tag dt ON dt.tag_id = t.id
            WHERE dt.download_id = ? AND t.user_id = ?
            ORDER BY t.name ASC
            """,
            (row["id"], row_user_id),
        )
        row["tags"] = [x["name"] for x in tags]
        row["subtitle_languages"] = json.loads(row["subtitle_languages"] or "[]")
        row["metadata"] = _safe_json_loads(row.get("metadata") or "{}")
    return rows


def create_download(payload: dict[str, Any], user_id: int, from_sync: bool = False) -> dict[str, Any]:
    ts = now_iso()
    local_uid = _payload_value(payload, "local_uid", "entity_local_id", "localId", default=f"dl-{uuid.uuid4().hex}")
    source_url = str(_payload_value(payload, "url", "source_url", "sourceUrl", default="")).strip()
    if not source_url:
        raise ValueError("source_url is required")

    existing = fetch_one("SELECT * FROM downloads WHERE user_id = ? AND local_uid = ?", (user_id, local_uid))
    if existing:
        return existing

    download_type = _normalize_download_type(_payload_value(payload, "download_type", "downloadType", "type", default="audio_mp3"))
    payload_video_quality = _payload_value(payload, "video_quality", "videoQuality")
    payload_audio_quality = _payload_value(payload, "audio_quality", "audioQuality")
    normalized_video_quality = payload_video_quality if download_type == "video_mp4" else None
    normalized_audio_quality = payload_audio_quality if download_type == "audio_mp3" else None
    duplicate = _find_duplicate_download(
        user_id=user_id,
        source_url=source_url,
        local_uid=local_uid,
        requested_type=str(download_type),
        requested_video_quality=str(normalized_video_quality or ""),
        requested_audio_quality=str(normalized_audio_quality or ""),
    )
    if duplicate:
        _log_activity(
            user_id,
            int(duplicate.get("id")) if duplicate.get("id") else None,
            "download_duplicate",
            "Solicitud duplicada detectada",
            {"source_url": source_url, "duplicate_of_id": duplicate.get("id")},
        )
        return duplicate

    subtitle_enabled = bool(_payload_value(payload, "subtitle_enabled", "subtitleEnabled", default=False))
    subtitle_language = _payload_value(payload, "subtitle_language", "subtitleLanguage", default="es")
    custom_name = _payload_value(payload, "custom_name", "customName")
    note = _payload_value(payload, "note", "notes")
    collection_id = _payload_value(payload, "collection_id", "collectionId")

    row_values = (
        custom_name or "New download",
        custom_name,
        download_type,
        "queued",
        source_url,
        collection_id,
        note,
        to_json(([subtitle_language] if subtitle_enabled else [])),
        "syncing" if not from_sync else "synced",
        to_json(
            {
                "audio_quality": normalized_audio_quality,
                "video_quality": normalized_video_quality,
                "save_thumbnail": bool(_payload_value(payload, "save_thumbnail", "saveThumbnail", default=True)),
                "save_metadata": bool(_payload_value(payload, "save_metadata", "saveMetadata", default=True)),
                "source_url_normalized": _canonical_source_url(source_url),
                "progress_percent": 0,
                "progress_state": "queued",
                "progress_line": "En cola",
            }
        ),
        ts,
    )

    sql = """
        INSERT INTO downloads(
            user_id, local_uid, title, custom_name, type, status, source_url, collection_id, notes,
            subtitle_languages, favorite, archived, sync_status, file_exists, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?, ?)
    """

    try:
        cur = execute(sql, (user_id, local_uid, *row_values))
    except sqlite3.IntegrityError:
        fresh_local_uid = f"dl-{uuid.uuid4().hex}"
        cur = execute(sql, (user_id, fresh_local_uid, *row_values))

    download_id = int(cur.lastrowid)

    tags = payload.get("tags") or []
    if isinstance(tags, str):
        tags = [x.strip() for x in tags.split(",") if x.strip()]
    _upsert_tags(download_id, user_id, tags)

    _log_activity(user_id, download_id, "download_created", "Download created from API", {"source": "sync" if from_sync else "direct"})
    enqueue_download(download_id)

    return fetch_one("SELECT * FROM downloads WHERE id = ? AND user_id = ?", (download_id, user_id)) or {}
