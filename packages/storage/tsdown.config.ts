import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts', 'src/aws.ts', 'src/s3Url.ts'],
	clean: true,
	outDir: 'dist',
	format: ['cjs', 'esm'],
	sourcemap: true,
	dts: true,
	outExtensions: (ctx) => ({
		js: ctx.format === 'es' ? '.mjs' : '.cjs',
	}),
	external: [
		'@aws-sdk/client-s3',
		'@aws-sdk/s3-presigned-post',
		'@aws-sdk/s3-request-presigner',
	],
});
