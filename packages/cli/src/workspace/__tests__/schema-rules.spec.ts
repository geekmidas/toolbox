import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { formatValidationErrors, safeValidateWorkspaceConfig } from '../schema';

const STAGES = { local: 'dev', deployed: ['prod'] };

const messages = (config: unknown) => {
	const result = safeValidateWorkspaceConfig(config);
	return result.success
		? []
		: result.error!.issues.map((issue) => issue.message);
};

describe('workspace config rules', () => {
	describe('a mobile app', () => {
		const mobile = (framework?: string) => ({
			stages: STAGES,
			apps: {
				app: {
					type: 'mobile',
					path: 'apps/app',
					port: 8081,
					...(framework ? { framework } : {}),
				},
			},
		});

		it('is accepted with a mobile framework', () => {
			expect(messages(mobile('expo'))).toEqual([]);
		});

		it('is refused without one, or with a web framework', () => {
			const missing = messages(mobile());
			const web = messages(mobile('nextjs'));

			for (const found of [missing, web]) {
				expect(found.join('\n')).toContain(
					'Mobile apps must have a valid mobile framework',
				);
			}
		});
	});

	it('needs a workspace name to keep state in SSM', () => {
		const state = { provider: 'ssm', region: 'eu-west-1' };

		expect(messages({ stages: STAGES, state }).join('\n')).toContain(
			'Workspace name is required when using SSM state provider',
		);
		expect(messages({ name: 'shop', stages: STAGES, state })).toEqual([]);
	});
});

describe('formatValidationErrors', () => {
	it('lists an issue with no path by its message alone', () => {
		const error = new z.ZodError([
			{ code: 'custom', message: 'Something is off', path: [], input: {} },
		]);

		expect(formatValidationErrors(error)).toContain('  - Something is off');
	});
});
