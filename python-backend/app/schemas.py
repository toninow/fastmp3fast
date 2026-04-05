from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ApiResponse(BaseModel):
    ok: bool = True
    message: str = "OK"
    data: Any | None = None


class LoginRequest(BaseModel):
    login: str
    password: str
    remember: bool = False
    device_name: str | None = None


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=60)
    email: str | None = None
    name: str | None = None
    password: str = Field(min_length=8, max_length=255)
    is_admin: bool = False


class DownloadCreateRequest(BaseModel):
    url: str = Field(min_length=5)
    download_type: str
    video_quality: str | None = None
    audio_quality: str | None = None
    custom_name: str | None = None
    collection_id: str | None = None
    tags: list[str] = Field(default_factory=list)
    note: str | None = None
    subtitle_enabled: bool = False
    subtitle_language: str | None = "es"
    save_thumbnail: bool = True
    save_metadata: bool = True
    local_uid: str | None = None
    is_offline_queued: bool = False


class DownloadUpdateRequest(BaseModel):
    custom_name: str | None = None
    collection_id: str | None = None
    favorite: bool | None = None
    archived: bool | None = None
    notes: str | None = None
    status: str | None = None
    tags: list[str] | None = None


class CollectionCreateRequest(BaseModel):
    name: str
    description: str | None = None
    color: str | None = "#A3FF12"
    icon: str | None = "folder"
    sort_order: int = 0
    item_ids: list[int | str] = Field(default_factory=list)


class SubtitleCreateRequest(BaseModel):
    language: str = "es"
    format: Literal["srt", "vtt"] = "vtt"
    path: str
    is_default: bool = False


class PlaybackUpsertRequest(BaseModel):
    position_seconds: int
    duration_seconds: int
    percent: float
    volume: float = 1.0
    speed: float = 1.0
    is_completed: bool = False
    updated_from: str = "web"


class SyncOperationPayload(BaseModel):
    operation: str
    entity_type: str
    entity_local_id: str | None = None
    entity_remote_id: int | None = None
    payload: dict[str, Any] | None = None


class SyncStoreRequest(BaseModel):
    operations: list[SyncOperationPayload]


class SettingsUpsertRequest(BaseModel):
    items: list[dict[str, Any]]
