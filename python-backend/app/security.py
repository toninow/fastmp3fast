from __future__ import annotations

import binascii
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings
from .db import execute, fetch_one, now_iso


bearer_scheme = HTTPBearer(auto_error=False)



def hash_value(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()



def hash_password(password: str) -> str:
    iterations = 390_000
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return f"pbkdf2_sha256${iterations}${salt}${binascii.hexlify(digest).decode('ascii')}"



def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False

    # Backward compatibility: legacy plain-text value.
    if not password_hash.startswith("pbkdf2_sha256$"):
        return hmac.compare_digest(password, password_hash)

    try:
        _, iterations_raw, salt, expected_hex = password_hash.split("$", 3)
        iterations = int(iterations_raw)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
        computed_hex = binascii.hexlify(digest).decode("ascii")
        return hmac.compare_digest(computed_hex, expected_hex)
    except Exception:
        return False



def create_token(user_id: int, username: str, remember: bool = False) -> str:
    plain = secrets.token_hex(40)
    expires = datetime.now(timezone.utc) + timedelta(hours=settings.token_ttl_hours * (30 if remember else 1))

    execute(
        """
        INSERT INTO tokens(user_id, token_hash, username, expires_at, created_at, last_used_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, hash_value(plain), username, expires.isoformat(), now_iso(), now_iso()),
    )
    return plain



def invalidate_token(token: str) -> None:
    execute("DELETE FROM tokens WHERE token_hash = ?", (hash_value(token),))



def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> dict[str, Any]:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    token_hash = hash_value(credentials.credentials)
    row = fetch_one(
        """
        SELECT
            t.id as token_id,
            t.token_hash,
            t.expires_at,
            t.user_id,
            u.id as id,
            u.username,
            u.email,
            u.name,
            u.is_admin,
            u.is_active
        FROM tokens t
        INNER JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ?
        LIMIT 1
        """,
        (token_hash,),
    )

    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    expires_at = row.get("expires_at")
    if expires_at:
        expires_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expires_dt:
            execute("DELETE FROM tokens WHERE token_hash = ?", (token_hash,))
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")

    if int(row.get("is_active") or 0) != 1:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")

    execute("UPDATE tokens SET last_used_at = ? WHERE token_hash = ?", (now_iso(), token_hash))

    return {
        "id": int(row["id"]),
        "name": row.get("name") or row.get("username"),
        "email": row.get("email"),
        "username": row.get("username"),
        "is_admin": bool(int(row.get("is_admin") or 0)),
    }
