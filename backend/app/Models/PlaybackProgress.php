<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PlaybackProgress extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'download_id',
        'position_seconds',
        'duration_seconds',
        'percent',
        'volume',
        'speed',
        'is_completed',
        'updated_from',
    ];

    protected $casts = [
        'is_completed' => 'boolean',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function download(): BelongsTo
    {
        return $this->belongsTo(Download::class);
    }
}
