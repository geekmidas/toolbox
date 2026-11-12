import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'edge',
		// Route 53 against the local AWS emulator.
		globalSetup: ['../testkit/test/awsSetup.ts'],
	},
});
