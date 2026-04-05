<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Subtitle extends Model
{
    use HasFactory;

    protected $fillable = [
        'download_id',
        'language',
        'format',
        'path',
        'is_default',
    ];

    protected $casts = [
        'is_default' => 'boolean',
    ];

    public function download(): BelongsTo
    {
        return $this->belongsTo(Download::class);
    }
}
