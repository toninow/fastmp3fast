<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Download extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'remote_id',
        'local_uid',
        'title',
        'custom_name',
        'type',
        'status',
        'source_url',
        'uploader',
        'duration_seconds',
        'format',
        'size_bytes',
        'downloaded_at',
        'media_path',
        'thumbnail_path',
        'collection_id',
        'notes',
        'subtitle_languages',
        'favorite',
        'archived',
        'last_playback_position_seconds',
        'last_played_at',
        'sync_status',
        'error_message',
        'file_exists',
        'metadata',
    ];

    protected $casts = [
        'downloaded_at' => 'datetime',
        'last_played_at' => 'datetime',
        'subtitle_languages' => 'array',
        'favorite' => 'boolean',
        'archived' => 'boolean',
        'file_exists' => 'boolean',
        'metadata' => 'array',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function collection(): BelongsTo
    {
        return $this->belongsTo(Collection::class);
    }

    public function files(): HasMany
    {
        return $this->hasMany(DownloadFile::class);
    }

    public function subtitles(): HasMany
    {
        return $this->hasMany(Subtitle::class);
    }

    public function tags(): BelongsToMany
    {
        return $this->belongsToMany(Tag::class, 'download_tag');
    }

    public function playbackProgress(): HasMany
    {
        return $this->hasMany(PlaybackProgress::class);
    }
}
