#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from typing import Any


GENRES = OrderedDict(
    [
        (
            "latin_urbano",
            {
                "name": "01-LATIN-URBANO",
                "color": "#F7E733",
                "description": "Latin, urbano, regional, bachata, cumbia y rap en español",
                "tags": ["latin", "urbano", "espanol"],
            },
        ),
        (
            "rap_hiphop_trap",
            {
                "name": "02-RAP-HIPHOP-TRAP",
                "color": "#A3FF12",
                "description": "Rap, hip-hop, trap y boom bap",
                "tags": ["rap", "hiphop", "trap"],
            },
        ),
        (
            "rock_metal_alt",
            {
                "name": "03-ROCK-METAL-ALT",
                "color": "#67E8F9",
                "description": "Rock alternativo, nu metal, punk y hard rock",
                "tags": ["rock", "metal", "alternative"],
            },
        ),
        (
            "electro_techno_edm",
            {
                "name": "04-ELECTRO-TECHNO-EDM",
                "color": "#6EE7B7",
                "description": "Techno, electronic, house, dance y remixes",
                "tags": ["electronic", "techno", "edm"],
            },
        ),
        (
            "pop_misc",
            {
                "name": "05-POP-INDIE-OTROS",
                "color": "#F97316",
                "description": "Pop, indie, soundtrack y varios",
                "tags": ["pop", "indie", "misc"],
            },
        ),
    ]
)

LATIN_KEYWORDS = {
    "bachat", "fukuoka", "corrido", "farsante", "maldita", "mujer", "perdon", "perdona", "romantika",
    "humo", "fasito", "si no", "me gusta", "tomo", "olvidarte", "vecina", "hijita", "que lio", "qué lío",
    "represento", "rapsincorte", "elissir", "sol sale", "estilo libre", "palabras", "primera flor", "disculpame",
    "frágil", "causa y efecto", "algun dia", "algún día", "cantina", "a la voz", "los sueños", "abraza", "contrabando",
    "traicion", "traición", "felicidad", "aire", "nunca sera", "nunca será", "la clase", "la fama", "pura droga",
    "le va doler", "perseus", "mensaje", "vivir para contarlo", "tipos de mc", "el regreso", "el sexto mandamiento",
}

RAP_KEYWORDS = {
    "rap", "hip hop", "hiphop", "trap", "gang", "hood", "bucktown", "efx", "big pun", "fat joe", "knife talk",
    "project pat", "m.a.a.d", "cream", "c.r.e.a.m", "c.r.e.m.a", "tomodachi", "bzrp", "out west", "whats poppin",
    "fear", "all caps", "throw your set", "walk it talk it", "drake", "21 savage", "big sean", "nasty",
}

ROCK_KEYWORDS = {
    "linkin", "numb", "faint", "in the end", "what ive done", "crawling", "from the inside", "given up",
    "chop suey", "mr brightside", "song 2", "creep", "wonderwall", "rebel yell", "radioactive", "phenomenon",
    "du riechst", "engel", "ich will", "obstacle", "the reason", "prisoner of society", "scream aim fire",
    "the middle", "cold shoulder", "adventure of a lifetime", "dont you forget about me", "toy boy",
}

ELECTRO_KEYWORDS = {
    "techno", "edm", "house", "dance", "remix", "mix", "edit", "nightcall", "insomnia", "dancin", "future breeze",
    "pump panel", "played-a-live", "love tonight", "you know you like it", "echo", "confusion", "push up", "maria i like it loud",
    "cha cha cha", "tattoo", "queen of kings", "we are the people", "all i ever wanted", "i need you lovin", "forever young",
    "out of control", "home alone", "latch", "find me", "the end", "boom", "robota", "psycho dreams", "after dark",
}


def _slug(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    return value or "item"


def _norm(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", text.lower()).strip()


def _tokens(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{2,}", _norm(value)))


def parse_tracks(raw_text: str) -> list[str]:
    tracks: list[str] = []
    seen: set[str] = set()
    for raw in raw_text.splitlines():
        line = raw.strip()
        if not line:
            continue
        m = re.match(r"^\s*\d+\.\s*(.+?)\s*$", line)
        title = m.group(1).strip() if m else line
        if not title:
            continue
        key = _norm(title)
        if key in seen:
            continue
        seen.add(key)
        tracks.append(title)
    return tracks


def classify_track(title: str) -> str:
    t = _norm(title)
    if any(k in t for k in LATIN_KEYWORDS) or re.search(r"[áéíóúñ¿¡]", title.lower()):
        return "latin_urbano"
    if any(k in t for k in RAP_KEYWORDS):
        return "rap_hiphop_trap"
    if any(k in t for k in ROCK_KEYWORDS):
        return "rock_metal_alt"
    if any(k in t for k in ELECTRO_KEYWORDS):
        return "electro_techno_edm"
    return "pop_misc"


def api_request(
    base_url: str,
    method: str,
    path: str,
    data: dict[str, Any] | None = None,
    token: str | None = None,
    timeout: int = 120,
) -> tuple[int, dict[str, Any]]:
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


def choose_best_result(query: str, results: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not results:
        return None
    qn = _norm(query)
    qt = _tokens(query)

    best: tuple[float, dict[str, Any]] | None = None
    for item in results:
        title = str(item.get("title") or "")
        tn = _norm(title)
        tt = _tokens(title)
        inter = len(qt & tt)
        score = inter * 5
        if qn and qn in tn:
            score += 30
        if "official" in tn:
            score += 2
        if "lyrics" in tn:
            score -= 2
        duration = item.get("duration_seconds")
        if isinstance(duration, int) and 100 <= duration <= 600:
            score += 2
        score -= abs(len(tt) - len(qt)) * 0.2

        if best is None or score > best[0]:
            best = (score, item)

    return best[1] if best else results[0]


def ensure_collection(
    base_url: str,
    token: str,
    desired_name: str,
    description: str,
    color: str,
    sort_order: int,
) -> dict[str, Any]:
    status, payload = api_request(base_url, "GET", "/collections", token=token)
    if status != 200:
        raise RuntimeError(f"No se pudo listar colecciones: {status} {payload}")
    rows = payload.get("data") or []
    for row in rows:
        if str(row.get("name") or "").strip().lower() == desired_name.strip().lower():
            return row

    status, created = api_request(
        base_url,
        "POST",
        "/collections",
        {
            "name": desired_name,
            "description": description,
            "color": color,
            "icon": "folder",
            "sort_order": sort_order,
            "item_ids": [],
        },
        token=token,
    )
    if status != 200:
        raise RuntimeError(f"No se pudo crear colección {desired_name}: {status} {created}")
    return created.get("data") or {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Importador masivo FASTMP3FAST por género")
    parser.add_argument("--base-url", default="https://servidormp.com/fastmp3fast/api/v1")
    parser.add_argument("--login", default="antonio")
    parser.add_argument("--password", default="corazon321")
    parser.add_argument("--input", required=True, help="Ruta del archivo txt con canciones numeradas")
    parser.add_argument("--root-dir", default="/var/www/html/fastmp3fast/fastmp3fast")
    parser.add_argument("--search-limit", type=int, default=5)
    args = parser.parse_args()

    raw_text = Path(args.input).read_text(encoding="utf-8")
    tracks = parse_tracks(raw_text)
    if not tracks:
        raise SystemExit("No se detectaron canciones en el archivo de entrada")

    root_dir = Path(args.root_dir)
    root_dir.mkdir(parents=True, exist_ok=True)

    status, login = api_request(
        args.base_url,
        "POST",
        "/auth/login",
        {"login": args.login, "password": args.password, "remember": True},
    )
    if status != 200:
        raise RuntimeError(f"Login falló: {status} {login}")

    token = (login.get("data") or {}).get("token")
    if not token:
        raise RuntimeError("No se obtuvo token de autenticación")

    now_tag = datetime.utcnow().strftime("%Y-%m-%d")

    collections: dict[str, dict[str, Any]] = {}
    collection_item_ids: dict[str, list[str]] = {}
    for idx, (genre_key, config) in enumerate(GENRES.items()):
        folder_name = config["name"]
        (root_dir / folder_name).mkdir(parents=True, exist_ok=True)
        col = ensure_collection(
            args.base_url,
            token,
            desired_name=folder_name,
            description=config["description"],
            color=config["color"],
            sort_order=idx,
        )
        collections[genre_key] = col
        existing_item_ids = [str(x) for x in (col.get("item_ids") or []) if str(x).strip()]
        collection_item_ids[genre_key] = existing_item_ids

    summary: dict[str, Any] = {
        "created_at": datetime.utcnow().isoformat() + "Z",
        "total_tracks": len(tracks),
        "queued": 0,
        "already_exists": 0,
        "search_failed": 0,
        "create_failed": 0,
        "genres": {k: 0 for k in GENRES.keys()},
        "items": [],
    }

    for i, track in enumerate(tracks, start=1):
        genre_key = classify_track(track)
        config = GENRES[genre_key]
        summary["genres"][genre_key] += 1

        query = f"{track} official audio"
        search_path = "/youtube/search?" + urllib.parse.urlencode({"q": query, "limit": args.search_limit})
        s_status, s_payload = api_request(args.base_url, "GET", search_path, token=token, timeout=120)

        if s_status != 200:
            summary["search_failed"] += 1
            summary["items"].append({"track": track, "genre": genre_key, "status": "search_failed", "error": str(s_payload)[:400]})
            continue

        results = ((s_payload.get("data") or {}).get("results") or [])
        pick = choose_best_result(track, results)
        if not pick:
            summary["search_failed"] += 1
            summary["items"].append({"track": track, "genre": genre_key, "status": "not_found"})
            continue

        url = str(pick.get("webpage_url") or "").strip()
        if not url:
            summary["search_failed"] += 1
            summary["items"].append({"track": track, "genre": genre_key, "status": "url_missing", "pick": pick})
            continue

        local_uid = "batch-" + hashlib.sha1(f"{genre_key}|{track}".encode("utf-8")).hexdigest()[:14]
        collection_local_id = str(collections[genre_key].get("local_id") or "")

        payload = {
            "url": url,
            "download_type": "audio_mp3",
            "audio_quality": "best",
            "custom_name": track,
            "collection_id": collection_local_id,
            "tags": [genre_key, *config["tags"], "batch", now_tag],
            "note": f"Importación masiva por género ({now_tag})",
            "subtitle_enabled": False,
            "save_thumbnail": True,
            "save_metadata": True,
            "local_uid": local_uid,
        }

        c_status, c_payload = api_request(args.base_url, "POST", "/downloads", payload, token=token, timeout=180)
        if c_status != 200:
            summary["create_failed"] += 1
            summary["items"].append(
                {
                    "track": track,
                    "genre": genre_key,
                    "status": "create_failed",
                    "url": url,
                    "error": str(c_payload)[:400],
                }
            )
            continue

        data = c_payload.get("data") or {}
        status_text = "already_exists" if data.get("already_exists") else "queued"
        if status_text == "already_exists":
            summary["already_exists"] += 1
        else:
            summary["queued"] += 1

        local_uid_resp = str(data.get("local_uid") or local_uid)
        if local_uid_resp not in collection_item_ids[genre_key]:
            collection_item_ids[genre_key].append(local_uid_resp)

        summary["items"].append(
            {
                "track": track,
                "genre": genre_key,
                "status": status_text,
                "url": url,
                "download_id": data.get("id"),
                "local_uid": local_uid_resp,
                "picked_title": pick.get("title"),
                "picked_uploader": pick.get("uploader"),
            }
        )

        if i % 20 == 0:
            print(f"[{i}/{len(tracks)}] procesadas | en cola={summary['queued']} | existentes={summary['already_exists']} | fallos={summary['search_failed'] + summary['create_failed']}")

    for idx, (genre_key, config) in enumerate(GENRES.items()):
        col = collections[genre_key]
        collection_id = int(col["id"])
        put_payload = {
            "name": config["name"],
            "description": config["description"],
            "color": config["color"],
            "icon": "folder",
            "sort_order": idx,
            "item_ids": collection_item_ids[genre_key],
        }
        u_status, u_payload = api_request(args.base_url, "PUT", f"/collections/{collection_id}", put_payload, token=token)
        if u_status != 200:
            print(f"[WARN] no se pudo actualizar items de colección {config['name']}: {u_status} {u_payload}")

    ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    summary_file = root_dir / f"import-summary-{ts}.json"
    summary_file.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    for genre_key, config in GENRES.items():
        folder = root_dir / config["name"]
        entries = [x for x in summary["items"] if x.get("genre") == genre_key]
        lines = []
        for idx, row in enumerate(entries, start=1):
            lines.append(f"{idx:03d}. {row.get('track')} | {row.get('status')} | {row.get('url','')}")
        (folder / "playlist.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "total_tracks": len(tracks),
        "queued": summary["queued"],
        "already_exists": summary["already_exists"],
        "search_failed": summary["search_failed"],
        "create_failed": summary["create_failed"],
        "root_dir": str(root_dir),
        "summary_file": str(summary_file),
        "collections": {k: GENRES[k]["name"] for k in GENRES},
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
