<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DownloadFile extends Model
{
    use HasFactory;

    protected $fillable = [
        'download_id',
        'kind',
        'path',
        'mime',
        'size_bytes',
        'duration_seconds',
        'exists_on_disk',
        'metadata',
    ];

    protected $casts = [
        'exists_on_disk' => 'boolean',
        'metadata' => 'array',
    ];

    public function download(): BelongsTo
    {
        return $this->belongsTo(Download::class);
    }
}
