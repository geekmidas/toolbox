import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { gkmConfigPlugin } from './src/vite-plugin-gkm-config';

export default defineConfig({
  plugins: [react(), tailwindcss(), gkmConfigPlugin()],
  base: '/__telescope/',
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
  },
});
