<?php

namespace App\Enums;

enum DownloadStatus: string
{
    case Pending = 'pending';
    case Queued = 'queued';
    case Processing = 'processing';
    case Completed = 'completed';
    case Error = 'error';
    case Offline = 'offline';
    case Syncing = 'syncing';
    case Paused = 'paused';
}
