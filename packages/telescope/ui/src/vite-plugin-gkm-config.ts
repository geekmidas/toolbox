import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

interface GkmConfig {
	server?: boolean | { port?: number };
	telescope?: { port?: number };
}

/**
 * Vite plugin that reads configuration from gkm.config.ts
 * to configure the dev server proxy.
 */
export function gkmConfigPlugin(): Plugin {
	let serverPort = 3000;

	return {
		name: 'gkm-config',
		async config() {
			const cwd = process.cwd();
			const configPath = resolve(cwd, 'gkm.config.ts');

			if (existsSync(configPath)) {
				try {
					const config = (await import(configPath)).default as GkmConfig;

					// Check for telescope.port first, then server.port
					if (config.telescope?.port) {
						serverPort = config.telescope.port;
					} else if (typeof config.server === 'object' && config.server.port) {
						serverPort = config.server.port;
					}
				} catch {
					// Silently fall back to default port
				}
			}

			return {
				server: {
					proxy: {
						'/__telescope/api': {
							target: `http://localhost:${serverPort}`,
							changeOrigin: true,
						},
						'/__telescope/ws': {
							target: `ws://localhost:${serverPort}`,
							ws: true,
						},
					},
				},
			};
		},
	};
}
