<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Setting;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class SettingController extends Controller
{
    use ApiResponse;

    public function index(Request $request)
    {
        return $this->success(
            Setting::query()->where('user_id', $request->user()->id)->orderBy('key')->get()
        );
    }

    public function upsert(Request $request)
    {
        $validated = $request->validate([
            'items' => ['required', 'array'],
            'items.*.key' => ['required', 'string', 'max:100'],
            'items.*.value' => ['nullable'],
        ]);

        $saved = [];

        foreach ($validated['items'] as $item) {
            $saved[] = Setting::query()->updateOrCreate(
                ['user_id' => $request->user()->id, 'key' => $item['key']],
                ['value' => $item['value']]
            );
        }

        return $this->success($saved, 'Configuración guardada');
    }
}
