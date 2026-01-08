import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [react(), tailwindcss()],
	base: '/__studio/',
	build: {
		outDir: '../dist/ui',
		emptyOutDir: true,
	},
});
