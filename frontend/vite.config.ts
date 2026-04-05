import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/fastmp3fast/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 4173,
  },
});
