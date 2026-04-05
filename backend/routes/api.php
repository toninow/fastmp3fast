<?php

use App\Http\Controllers\Api\ActivityLogController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CollectionController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\DownloadController;
use App\Http\Controllers\Api\PlaybackProgressController;
use App\Http\Controllers\Api\SettingController;
use App\Http\Controllers\Api\SubtitleController;
use App\Http\Controllers\Api\SyncController;
use App\Http\Controllers\Api\SystemStatusController;
use App\Http\Controllers\Api\TagController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function (): void {
    Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:6,1');

    Route::middleware('api.token')->group(function (): void {
        Route::get('/auth/me', [AuthController::class, 'me']);
        Route::post('/auth/logout', [AuthController::class, 'logout']);

        Route::get('/dashboard', DashboardController::class);
        Route::get('/system/status', SystemStatusController::class);

        Route::get('/downloads/formats', [DownloadController::class, 'formats']);
        Route::post('/downloads/{download}/retry', [DownloadController::class, 'retry']);
        Route::apiResource('/downloads', DownloadController::class);

        Route::apiResource('/collections', CollectionController::class);
        Route::get('/tags', [TagController::class, 'index']);
        Route::post('/tags', [TagController::class, 'store']);
        Route::delete('/tags/{tag}', [TagController::class, 'destroy']);

        Route::get('/subtitles', [SubtitleController::class, 'index']);
        Route::post('/downloads/{download}/subtitles', [SubtitleController::class, 'store']);

        Route::get('/playback', [PlaybackProgressController::class, 'index']);
        Route::put('/downloads/{download}/playback', [PlaybackProgressController::class, 'upsert']);

        Route::get('/sync', [SyncController::class, 'index']);
        Route::post('/sync', [SyncController::class, 'store']);
        Route::post('/sync/{syncOperation}/retry', [SyncController::class, 'retry']);

        Route::get('/activity', [ActivityLogController::class, 'index']);

        Route::get('/settings', [SettingController::class, 'index']);
        Route::put('/settings', [SettingController::class, 'upsert']);
    });
});
