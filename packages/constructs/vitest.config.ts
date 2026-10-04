import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'constructs',
		// The KMS cipher is tested against floci, the AWS emulator: started if
		// it is not already up, as for every suite that talks to it.
		globalSetup: ['../testkit/test/awsSetup.ts'],
	},
});
