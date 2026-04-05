<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ActivityLog extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'download_id',
        'event',
        'description',
        'context',
        'is_offline_event',
        'occurred_at',
    ];

    protected $casts = [
        'context' => 'array',
        'is_offline_event' => 'boolean',
        'occurred_at' => 'datetime',
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
