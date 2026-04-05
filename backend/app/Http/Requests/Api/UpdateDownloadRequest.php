<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class UpdateDownloadRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'custom_name' => ['nullable', 'string', 'max:255'],
            'collection_id' => ['nullable', 'integer', 'exists:collections,id'],
            'favorite' => ['nullable', 'boolean'],
            'archived' => ['nullable', 'boolean'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'status' => ['nullable', 'string', 'max:30'],
            'tags' => ['nullable', 'array'],
            'tags.*' => ['string', 'max:50'],
        ];
    }
}
