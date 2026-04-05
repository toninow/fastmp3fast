<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Tag;
use App\Support\ApiResponse;
use Illuminate\Http\Request;

class TagController extends Controller
{
    use ApiResponse;

    public function index(Request $request)
    {
        return $this->success(
            Tag::query()->where('user_id', $request->user()->id)->orderBy('name')->get()
        );
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:50'],
            'color' => ['nullable', 'string', 'max:24'],
        ]);

        $tag = Tag::query()->firstOrCreate(
            ['user_id' => $request->user()->id, 'name' => $validated['name']],
            ['color' => $validated['color'] ?? '#F7E733']
        );

        return $this->success($tag, 'Etiqueta creada', 201);
    }

    public function destroy(Request $request, Tag $tag)
    {
        abort_unless($tag->user_id === $request->user()->id, 404);
        $tag->delete();

        return $this->success(null, 'Etiqueta eliminada');
    }
}
