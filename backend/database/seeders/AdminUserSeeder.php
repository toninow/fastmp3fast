<?php

namespace Database\Seeders;

use App\Models\Collection;
use App\Models\Setting;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $user = User::query()->updateOrCreate(
            ['email' => 'admin@fastmp3fast.local'],
            [
                'name' => 'admin',
                'password' => Hash::make('Fastmp3fast123!'),
            ]
        );

        foreach ([
            ['name' => 'musica', 'color' => '#A3FF12', 'icon' => 'music'],
            ['name' => 'videos', 'color' => '#F7E733', 'icon' => 'film'],
            ['name' => 'favoritos', 'color' => '#A3FF12', 'icon' => 'star'],
            ['name' => 'pendientes', 'color' => '#F7E733', 'icon' => 'clock'],
            ['name' => 'trabajo', 'color' => '#6EE7B7', 'icon' => 'briefcase'],
        ] as $collection) {
            Collection::query()->firstOrCreate([
                'user_id' => $user->id,
                'name' => $collection['name'],
            ], [
                ...$collection,
                'description' => 'Lista base FASTMP3FAST',
                'is_system' => true,
            ]);
        }

        Setting::query()->updateOrCreate(
            ['user_id' => $user->id, 'key' => 'appearance'],
            ['value' => ['theme' => 'fastmp3fast-dark-neon']]
        );
    }
}
