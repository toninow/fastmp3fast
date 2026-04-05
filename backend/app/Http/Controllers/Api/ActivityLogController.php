<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActivityLog;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class ActivityLogController extends Controller
{
    use ApiResponse;

    public function index(Request $request)
    {
        $logs = ActivityLog::query()
            ->where('user_id', $request->user()->id)
            ->when($request->string('event')->isNotEmpty(), fn ($q) => $q->where('event', $request->string('event')))
            ->latest('occurred_at')
            ->paginate(30);

        return $this->success($logs);
    }
}
