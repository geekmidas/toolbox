import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'cli',
		// The `deploy/` suites drive real AWS SDK clients against the local
		// emulator — SSM for deploy state, S3 and IAM for backup destinations.
		// They were the only failing suites in the repo, and they were failing
		// because nothing started the emulator rather than because anything was
		// wrong with them.
		globalSetup: ['../testkit/test/awsSetup.ts'],
	},
});
