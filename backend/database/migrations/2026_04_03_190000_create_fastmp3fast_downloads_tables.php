<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('downloads', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('remote_id')->nullable()->index();
            $table->string('local_uid')->nullable()->index();
            $table->string('title');
            $table->string('custom_name')->nullable();
            $table->string('type', 50)->index();
            $table->string('status', 30)->default('pending')->index();
            $table->string('source_url', 2048);
            $table->string('uploader')->nullable();
            $table->unsignedInteger('duration_seconds')->nullable();
            $table->string('format', 20)->nullable();
            $table->unsignedBigInteger('size_bytes')->nullable();
            $table->timestamp('downloaded_at')->nullable();
            $table->string('media_path')->nullable();
            $table->string('thumbnail_path')->nullable();
            $table->unsignedBigInteger('collection_id')->nullable()->index();
            $table->text('notes')->nullable();
            $table->json('subtitle_languages')->nullable();
            $table->boolean('favorite')->default(false);
            $table->boolean('archived')->default(false);
            $table->unsignedInteger('last_playback_position_seconds')->default(0);
            $table->timestamp('last_played_at')->nullable();
            $table->string('sync_status', 30)->default('synced')->index();
            $table->text('error_message')->nullable();
            $table->boolean('file_exists')->default(false);
            $table->json('metadata')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['user_id', 'created_at']);
            $table->index(['user_id', 'status']);
        });

        Schema::create('download_files', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('download_id')->constrained('downloads')->cascadeOnDelete();
            $table->string('kind', 30);
            $table->string('path');
            $table->string('mime', 120)->nullable();
            $table->unsignedBigInteger('size_bytes')->nullable();
            $table->unsignedInteger('duration_seconds')->nullable();
            $table->boolean('exists_on_disk')->default(true);
            $table->json('metadata')->nullable();
            $table->timestamps();
        });

        Schema::create('subtitles', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('download_id')->constrained('downloads')->cascadeOnDelete();
            $table->string('language', 12)->default('es');
            $table->string('format', 10)->default('vtt');
            $table->string('path');
            $table->boolean('is_default')->default(false);
            $table->timestamps();

            $table->index(['download_id', 'language']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('subtitles');
        Schema::dropIfExists('download_files');
        Schema::dropIfExists('downloads');
    }
};
