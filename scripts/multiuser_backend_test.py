#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from typing import Any


def api_request(base_url: str, method: str, path: str, data: dict[str, Any] | None = None, token: str | None = None) -> tuple[int, dict[str, Any]]:
    url = f"{base_url}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)

    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "{}")
            return resp.status, payload
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            payload = json.loads(raw)
        except Exception:
            payload = {"raw": raw}
        return exc.code, payload


def main() -> int:
    parser = argparse.ArgumentParser(description="FASTMP3FAST multi-user backend verification")
    parser.add_argument("--base-url", default="https://www.servidormp.com/fastmp3fast/api/v1")
    parser.add_argument("--admin-login", default="antonio")
    parser.add_argument("--admin-password", default="corazon321")
    args = parser.parse_args()

    checks: list[dict[str, Any]] = []
    ok = True

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal ok
        checks.append({"name": name, "ok": cond, "detail": detail})
        if not cond:
            ok = False

    s, login = api_request(
        args.base_url,
        "POST",
        "/auth/login",
        {"login": args.admin_login, "password": args.admin_password, "remember": True},
    )
    check("admin_login", s == 200, str(login)[:300])
    if s != 200:
        print(json.dumps({"ok": False, "checks": checks}, ensure_ascii=True, indent=2))
        return 1

    admin_token = (login.get("data") or {}).get("token")
    if not admin_token:
        check("admin_token_present", False, "token missing")
        print(json.dumps({"ok": False, "checks": checks}, ensure_ascii=True, indent=2))
        return 1

    def ensure_user(username: str, password: str) -> None:
        status, payload = api_request(
            args.base_url,
            "POST",
            "/users",
            {
                "username": username,
                "email": f"{username}@fastmp3fast.local",
                "name": username.title(),
                "password": password,
                "is_admin": False,
            },
            token=admin_token,
        )
        check(f"ensure_user_{username}", status in (200, 422), str(payload)[:300])

    ensure_user("qa_usera", "QATest123*")
    ensure_user("qa_userb", "QATest123*")

    s, ua = api_request(args.base_url, "POST", "/auth/login", {"login": "qa_usera", "password": "QATest123*", "remember": True})
    check("usera_login", s == 200, str(ua)[:200])
    token_a = (ua.get("data") or {}).get("token")

    s, ub = api_request(args.base_url, "POST", "/auth/login", {"login": "qa_userb", "password": "QATest123*", "remember": True})
    check("userb_login", s == 200, str(ub)[:200])
    token_b = (ub.get("data") or {}).get("token")

    if not token_a or not token_b:
        print(json.dumps({"ok": False, "checks": checks}, ensure_ascii=True, indent=2))
        return 1

    s, _ = api_request(args.base_url, "POST", "/collections", {"name": "A Mixes", "item_ids": []}, token=token_a)
    check("usera_collection", s == 200)
    s, _ = api_request(args.base_url, "POST", "/collections", {"name": "B Videos", "item_ids": []}, token=token_b)
    check("userb_collection", s == 200)

    s, _ = api_request(
        args.base_url,
        "POST",
        "/downloads",
        {
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "download_type": "audio_mp3",
            "custom_name": "A-song-1",
            "local_uid": "qa-a-1",
            "subtitle_enabled": False,
        },
        token=token_a,
    )
    check("usera_download_create", s == 200)

    s, _ = api_request(
        args.base_url,
        "POST",
        "/downloads",
        {
            "url": "https://www.youtube.com/watch?v=oHg5SJYRHA0",
            "download_type": "video_mp4",
            "custom_name": "B-video-1",
            "local_uid": "qa-b-1",
            "subtitle_enabled": True,
            "subtitle_language": "es",
        },
        token=token_b,
    )
    check("userb_download_create", s == 200)

    s, upd = api_request(args.base_url, "PUT", "/downloads/by-local/qa-a-1", {"custom_name": "A-song-renamed"}, token=token_a)
    check("rename_by_local", s == 200 and (upd.get("data") or {}).get("custom_name") == "A-song-renamed", str(upd)[:200])

    s, _ = api_request(args.base_url, "DELETE", "/downloads/by-local/qa-a-1", token=token_a)
    check("delete_by_local", s == 200)

    s, all_downloads = api_request(args.base_url, "GET", "/downloads?scope=all", token=admin_token)
    rows = ((all_downloads.get("data") or {}).get("data") or []) if s == 200 else []
    check("admin_scope_all", s == 200 and any(str(x.get("local_uid")) == "qa-b-1" for x in rows), f"rows={len(rows)}")

    s, users_non_admin = api_request(args.base_url, "GET", "/users", token=token_a)
    check("users_forbidden_non_admin", s == 403, str(users_non_admin)[:200])

    s, yt = api_request(args.base_url, "GET", "/youtube/search?q=rickroll&limit=3", token=admin_token)
    check("youtube_search", s == 200 and isinstance((yt.get("data") or {}).get("results"), list), str(yt)[:200])

    s, rec = api_request(args.base_url, "GET", "/recommendations?limit=5", token=token_b)
    check("recommendations", s == 200 and isinstance((rec.get("data") or {}).get("results"), list), str(rec)[:200])

    print(json.dumps({"ok": ok, "checks": checks}, ensure_ascii=True, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
