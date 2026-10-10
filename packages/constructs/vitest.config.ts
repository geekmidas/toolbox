import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'constructs',
		// The KMS cipher is tested against floci, the AWS emulator: started if
		// it is not already up, as for every suite that talks to it.
		globalSetup: ['../testkit/test/awsSetup.ts'],
		// `*.test-d.ts` files are compiled and their type errors reported as
		// failures, so an assertion about a type fails when the type is wrong.
		typecheck: {
			enabled: true,
			include: ['src/**/*.test-d.ts'],
			tsconfig: './tsconfig.typecheck.json',
		},
	},
});
