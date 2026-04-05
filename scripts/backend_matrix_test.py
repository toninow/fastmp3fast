#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


RICKROLL_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def api_request(base_url: str, method: str, path: str, data: dict[str, Any] | None = None, token: str | None = None, timeout: int = 120) -> tuple[int, dict[str, Any]]:
    url = f"{base_url}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            payload = json.loads(raw) if raw else {}
            return resp.status, payload
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"raw": raw}
        return exc.code, payload


def fetch_downloads(base_url: str, token: str) -> list[dict[str, Any]]:
    status, payload = api_request(base_url, "GET", "/downloads", token=token)
    if status != 200:
        raise RuntimeError(f"GET /downloads failed ({status}): {payload}")

    data = payload.get("data", {})
    rows = data.get("data", []) if isinstance(data, dict) else []
    if not isinstance(rows, list):
        return []
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="FASTMP3FAST backend matrix test")
    parser.add_argument("--base-url", default="http://127.0.0.1:8001/api/v1")
    parser.add_argument("--login", default="admin")
    parser.add_argument("--password", default="Fastmp3fast123!")
    parser.add_argument("--timeout", type=int, default=240, help="Max wait seconds for matrix jobs")
    parser.add_argument("--poll", type=float, default=3.0)
    parser.add_argument("--allow-errors", action="store_true", help="Do not fail test when download status ends in error")
    args = parser.parse_args()

    failures: list[str] = []

    status, login = api_request(
        args.base_url,
        "POST",
        "/auth/login",
        {"login": args.login, "password": args.password, "remember": True},
    )
    if status != 200:
        print(json.dumps({"ok": False, "step": "login", "status": status, "payload": login}, ensure_ascii=True, indent=2))
        return 1

    token = (login.get("data") or {}).get("token")
    if not token:
        print(json.dumps({"ok": False, "step": "login", "error": "token missing", "payload": login}, ensure_ascii=True, indent=2))
        return 1

    status, system = api_request(args.base_url, "GET", "/system/status", token=token)
    if status != 200:
        failures.append(f"system/status failed: {status}")

    status, formats = api_request(
        args.base_url,
        "GET",
        f"/downloads/formats?url={urllib.parse.quote(RICKROLL_URL, safe='')}",
        token=token,
        timeout=180,
    )
    if status != 200:
        failures.append(f"downloads/formats failed: {status}")
    elif not ((formats.get("data") or {}).get("success")):
        failures.append("downloads/formats returned success=false")

    prefix = f"suite-{int(time.time())}"
    cases: list[tuple[str, dict[str, Any]]] = [
        (
            "mp4_360_sub_es",
            {
                "url": RICKROLL_URL,
                "download_type": "video_mp4",
                "video_quality": "360p",
                "audio_quality": "128kbps",
                "custom_name": f"{prefix}-mp4-360",
                "subtitle_enabled": True,
                "subtitle_language": "es",
            },
        ),
        (
            "mp4_1080_sub_en",
            {
                "url": RICKROLL_URL,
                "download_type": "video_mp4",
                "video_quality": "1080p",
                "audio_quality": "192kbps",
                "custom_name": f"{prefix}-mp4-1080",
                "subtitle_enabled": True,
                "subtitle_language": "en",
            },
        ),
        (
            "mp3_320",
            {
                "url": RICKROLL_URL,
                "download_type": "audio_mp3",
                "audio_quality": "320kbps",
                "custom_name": f"{prefix}-mp3-320",
                "subtitle_enabled": False,
            },
        ),
        (
            "mp3_128",
            {
                "url": RICKROLL_URL,
                "download_type": "audio_mp3",
                "audio_quality": "128kbps",
                "custom_name": f"{prefix}-mp3-128",
                "subtitle_enabled": False,
            },
        ),
    ]

    created: list[tuple[str, int]] = []
    for name, payload in cases:
        status, response = api_request(args.base_url, "POST", "/downloads", payload, token=token)
        if status != 200:
            failures.append(f"create {name} failed: status={status}")
            continue

        row = response.get("data") or {}
        download_id = row.get("id")
        if not isinstance(download_id, int):
            failures.append(f"create {name} missing id")
            continue

        created.append((name, download_id))

    duplicate_uid = f"{prefix}-duplicate-uid"
    duplicate_ids: list[int] = []
    for idx in range(2):
        status, response = api_request(
            args.base_url,
            "POST",
            "/downloads",
            {
                "url": RICKROLL_URL,
                "download_type": "audio_mp3",
                "audio_quality": "192kbps",
                "custom_name": f"{prefix}-dup",
                "local_uid": duplicate_uid,
                "subtitle_enabled": False,
            },
            token=token,
        )
        if status != 200:
            failures.append(f"duplicate local_uid call #{idx+1} failed with status={status}")
            continue
        response_id = (response.get("data") or {}).get("id")
        if isinstance(response_id, int):
            duplicate_ids.append(response_id)

    if len(duplicate_ids) == 2 and duplicate_ids[0] != duplicate_ids[1]:
        failures.append(f"duplicate local_uid is not idempotent: ids={duplicate_ids}")

    pending = {download_id for _, download_id in created}
    started = time.time()
    final_map: dict[int, dict[str, Any]] = {}

    while pending and (time.time() - started) < args.timeout:
        try:
            rows = fetch_downloads(args.base_url, token)
        except Exception as exc:
            failures.append(str(exc))
            break

        current_map = {int(row["id"]): row for row in rows if isinstance(row.get("id"), int)}
        for did in list(pending):
            row = current_map.get(did)
            if not row:
                continue
            if row.get("status") not in {"queued", "processing", "pending", "syncing", "offline"}:
                pending.remove(did)
                final_map[did] = row

        if pending:
            time.sleep(args.poll)

    if pending:
        failures.append(f"timeout waiting downloads: pending_ids={sorted(pending)}")

    for name, did in created:
        row = final_map.get(did)
        if row is None:
            continue

        status = str(row.get("status"))
        if not args.allow_errors and status != "completed":
            failures.append(f"{name} finished with status={status}, error={row.get('error_message')}")

    summary = {
        "ok": len(failures) == 0,
        "base_url": args.base_url,
        "system": system.get("data") if isinstance(system, dict) else system,
        "created": [
            {
                "name": name,
                "id": did,
                "status": final_map.get(did, {}).get("status"),
                "format": final_map.get(did, {}).get("format"),
                "error_message": final_map.get(did, {}).get("error_message"),
                "subtitle_languages": final_map.get(did, {}).get("subtitle_languages"),
            }
            for name, did in created
        ],
        "duplicate_uid_ids": duplicate_ids,
        "failures": failures,
    }

    print(json.dumps(summary, ensure_ascii=True, indent=2))
    return 0 if len(failures) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
