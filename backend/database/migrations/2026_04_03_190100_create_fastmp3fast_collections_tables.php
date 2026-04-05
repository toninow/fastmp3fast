<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('collections', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('color', 24)->default('#A3FF12');
            $table->string('icon', 50)->nullable();
            $table->boolean('is_system')->default(false);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['user_id', 'name']);
        });

        Schema::create('collection_items', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('collection_id')->constrained('collections')->cascadeOnDelete();
            $table->foreignId('download_id')->constrained('downloads')->cascadeOnDelete();
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

            $table->unique(['collection_id', 'download_id']);
            $table->index(['collection_id', 'position']);
        });

        Schema::create('tags', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('color', 24)->default('#F7E733');
            $table->timestamps();

            $table->unique(['user_id', 'name']);
        });

        Schema::create('download_tag', function (Blueprint $table): void {
            $table->foreignId('download_id')->constrained('downloads')->cascadeOnDelete();
            $table->foreignId('tag_id')->constrained('tags')->cascadeOnDelete();
            $table->primary(['download_id', 'tag_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('download_tag');
        Schema::dropIfExists('tags');
        Schema::dropIfExists('collection_items');
        Schema::dropIfExists('collections');
    }
};
