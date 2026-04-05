<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('playback_progress', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('download_id')->constrained('downloads')->cascadeOnDelete();
            $table->unsignedInteger('position_seconds')->default(0);
            $table->unsignedInteger('duration_seconds')->default(0);
            $table->decimal('percent', 5, 2)->default(0);
            $table->decimal('volume', 5, 2)->default(1.0);
            $table->decimal('speed', 3, 2)->default(1.0);
            $table->boolean('is_completed')->default(false);
            $table->string('updated_from', 20)->default('web');
            $table->timestamps();

            $table->unique(['user_id', 'download_id']);
        });

        Schema::create('sync_operations', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('operation', 50);
            $table->string('entity_type', 50);
            $table->string('entity_local_id')->nullable();
            $table->unsignedBigInteger('entity_remote_id')->nullable();
            $table->json('payload')->nullable();
            $table->string('status', 20)->default('pending')->index();
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->text('last_error')->nullable();
            $table->timestamp('synced_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
        });

        Schema::create('activity_logs', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('download_id')->nullable()->constrained('downloads')->nullOnDelete();
            $table->string('event', 60);
            $table->string('description')->nullable();
            $table->json('context')->nullable();
            $table->boolean('is_offline_event')->default(false);
            $table->timestamp('occurred_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'event']);
            $table->index(['user_id', 'occurred_at']);
        });

        Schema::create('settings', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('key', 100);
            $table->json('value')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'key']);
        });

        Schema::create('api_tokens', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name')->default('default');
            $table->string('token_hash', 64)->unique();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('api_tokens');
        Schema::dropIfExists('settings');
        Schema::dropIfExists('activity_logs');
        Schema::dropIfExists('sync_operations');
        Schema::dropIfExists('playback_progress');
    }
};
