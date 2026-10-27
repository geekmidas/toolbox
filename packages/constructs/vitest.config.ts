import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'constructs',
		// The KMS cipher is tested against floci, the AWS emulator, and direct
		// uploads and processors' derivatives against MinIO: each started if it
		// is not already up, as for every suite that talks to it. Redis carries
		// a WebSocket surface's frames between replicas.
		globalSetup: [
			'../testkit/test/awsSetup.ts',
			'../testkit/test/minioSetup.ts',
			'../testkit/test/redisSetup.ts',
		],
		// `*.test-d.ts` files are compiled and their type errors reported as
		// failures, so an assertion about a type fails when the type is wrong.
		typecheck: {
			enabled: true,
			include: ['src/**/*.test-d.ts'],
			tsconfig: './tsconfig.typecheck.json',
		},
	},
});
