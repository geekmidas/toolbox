import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'storage',
		// The S3 client is tested against a real MinIO, started from the repo's
		// compose file on the port `MINIO_API_HOST_PORT` publishes it on.
		globalSetup: ['../testkit/test/minioSetup.ts'],
	},
});
