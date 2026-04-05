<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class StoreDownloadRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'url' => ['required', 'url', 'max:2048'],
            'download_type' => ['required', 'string', 'max:60'],
            'video_quality' => ['nullable', 'string', 'max:40'],
            'audio_quality' => ['nullable', 'string', 'max:40'],
            'custom_name' => ['nullable', 'string', 'max:255'],
            'collection_id' => ['nullable', 'integer', 'exists:collections,id'],
            'tags' => ['nullable', 'array'],
            'tags.*' => ['string', 'max:50'],
            'note' => ['nullable', 'string', 'max:2000'],
            'subtitle_enabled' => ['nullable', 'boolean'],
            'subtitle_language' => ['nullable', 'string', 'max:12'],
            'save_thumbnail' => ['nullable', 'boolean'],
            'save_metadata' => ['nullable', 'boolean'],
            'local_uid' => ['nullable', 'string', 'max:64'],
            'is_offline_queued' => ['nullable', 'boolean'],
        ];
    }
}
