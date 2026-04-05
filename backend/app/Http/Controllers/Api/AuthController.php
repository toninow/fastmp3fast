<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\LoginRequest;
use App\Models\ApiToken;
use App\Models\User;
use App\Support\ApiResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    use ApiResponse;

    public function login(LoginRequest $request)
    {
        $validated = $request->validated();

        $user = User::query()
            ->where('email', $validated['login'])
            ->orWhere('name', $validated['login'])
            ->first();

        if (! $user || ! Hash::check($validated['password'], $user->password)) {
            return $this->error('Credenciales inválidas.', 401);
        }

        $plainToken = bin2hex(random_bytes(40));

        ApiToken::query()->create([
            'user_id' => $user->id,
            'name' => $validated['device_name'] ?? 'web-pwa',
            'token_hash' => hash('sha256', $plainToken),
            'expires_at' => ! empty($validated['remember']) ? now()->addDays(30) : now()->addDay(),
        ]);

        return $this->success([
            'token' => $plainToken,
            'token_type' => 'Bearer',
            'user' => $user,
        ], 'Login correcto');
    }

    public function me(Request $request)
    {
        return $this->success($request->user());
    }

    public function logout(Request $request)
    {
        $token = $request->attributes->get('apiToken');

        if ($token) {
            $token->delete();
        }

        return $this->success(null, 'Sesión cerrada correctamente');
    }
}
