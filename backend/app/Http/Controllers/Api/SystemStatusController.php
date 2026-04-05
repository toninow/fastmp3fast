<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Downloads\FfmpegService;
use App\Support\ApiResponse;
use Symfony\Component\Process\Process;

class SystemStatusController extends Controller
{
    use ApiResponse;

    public function __invoke(FfmpegService $ffmpegService)
    {
        $yt = new Process([config('fastmp3fast.yt_dlp_binary', 'yt-dlp'), '--version']);
        $yt->run();

        return $this->success([
            'php_version' => phpversion(),
            'yt_dlp' => [
                'available' => $yt->isSuccessful(),
                'version' => trim($yt->getOutput()) ?: null,
                'stderr' => trim($yt->getErrorOutput()) ?: null,
            ],
            'ffmpeg' => [
                'available' => $ffmpegService->isAvailable(),
            ],
            'queue_connection' => config('queue.default'),
            'app_env' => config('app.env'),
        ]);
    }
}
