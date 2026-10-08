import { describe, expect, it } from 'vitest';
import { safeValidateWorkspaceConfig } from '../../workspace/schema';
import {
	checkStageProvider,
	stageProvider,
	UnknownStageProvider,
} from '../config';
import { provisionHint, stageProviderNotes } from '../notes';
import { S3ProviderConfigInvalid } from '../s3/errors';

const workspace = (objects?: Record<string, unknown>) => ({
	stages: { local: 'development' },
	deploy: objects ? { objects } : {},
});

describe('deploy.objects.<stage>', () => {
	it("takes 'external', false and { provider: 's3', … }", () => {
		expect(checkStageProvider('objects', 'prod', 'external')).toBe('external');
		expect(checkStageProvider('objects', 'prod', false)).toBe(false);
		expect(
			checkStageProvider('objects', 'prod', {
				provider: 's3',
				region: 'eu-west-1',
				versioning: true,
			}),
		).toEqual({ provider: 's3', region: 'eu-west-1', versioning: true });
	});

	it("refuses 'minio', listing what it takes", () => {
		expect(() => checkStageProvider('objects', 'prod', 'minio')).toThrow(
			UnknownStageProvider,
		);
		expect(() => checkStageProvider('objects', 'prod', 'minio')).toThrow(
			"deploy.objects.prod is \"minio\", which is not a provider gkm has for objects. It takes 'external', { provider: 's3' }, false.",
		);
		expect(() =>
			checkStageProvider('objects', 'prod', { provider: 'minio' }),
		).toThrow(UnknownStageProvider);
	});

	it('refuses a field s3 does not take, and a region that is not one', () => {
		expect(() =>
			checkStageProvider('objects', 'prod', { provider: 's3', bucket: 'x' }),
		).toThrow(S3ProviderConfigInvalid);
		expect(() =>
			checkStageProvider('objects', 'prod', {
				provider: 's3',
				region: 'Europe',
			}),
		).toThrow(/AWS region code/);
		expect(() =>
			checkStageProvider('objects', 'prod', {
				provider: 's3',
				versioning: 'yes',
			}),
		).toThrow(/versioning/);
	});

	it('fails the workspace config with the same words', () => {
		const result = safeValidateWorkspaceConfig({
			name: 'shop',
			stages: { local: 'development', deployed: ['production'] },
			apps: { api: { type: 'backend', path: 'apps/api', port: 3000 } },
			deploy: { objects: { production: 'minio' } },
		});
		expect(result.success).toBe(false);
		expect(JSON.stringify(result.error?.issues)).toContain(
			"It takes 'external', { provider: 's3' }, false.",
		);
	});

	it('loads a config that sets nothing, and one that names s3', () => {
		expect(
			safeValidateWorkspaceConfig({
				name: 'shop',
				stages: { local: 'development', deployed: ['production'] },
				apps: { api: { type: 'backend', path: 'apps/api', port: 3000 } },
			}).success,
		).toBe(true);
		expect(
			safeValidateWorkspaceConfig({
				name: 'shop',
				stages: { local: 'development', deployed: ['production'] },
				apps: { api: { type: 'backend', path: 'apps/api', port: 3000 } },
				deploy: { objects: { production: { provider: 's3' } } },
			}).success,
		).toBe(true);
	});
});

describe("what a stage's entry resolves to", () => {
	it('is external when nothing is set, and on the local stage whatever is', () => {
		expect(stageProvider(workspace(), 'objects', 'prod')).toEqual({
			mode: 'external',
		});
		expect(
			stageProvider(
				workspace({ development: { provider: 's3' } }),
				'objects',
				'development',
			),
		).toEqual({ mode: 'external' });
	});

	it('is the provider a deployed stage names, or none for false', () => {
		expect(
			stageProvider(workspace({ prod: { provider: 's3' } }), 'objects', 'prod'),
		).toEqual({ mode: 'provider', name: 's3', config: { provider: 's3' } });
		expect(
			stageProvider(workspace({ prod: false }), 'objects', 'prod'),
		).toEqual({ mode: 'none' });
	});
});

describe('the hint a missing key is given', () => {
	it('names the provision command and the credentials it needs', () => {
		const hint = provisionHint(
			workspace({ prod: { provider: 's3' } }) as never,
			'objects',
			'prod',
		);
		expect(hint).toBe(
			"deploy.objects.prod is s3: gkm setup --stage prod creates it and writes this key, with the stage's AWS account — --profile <name>, AWS_PROFILE, or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY (in CI, what aws-actions/configure-aws-credentials exports)",
		);
	});

	it('is nothing for an external stage, whose keys are yours', () => {
		expect(stageProviderNotes(workspace() as never, 'prod')).toEqual({});
		expect(
			stageProviderNotes(workspace({ prod: 'external' }) as never, 'prod'),
		).toEqual({});
	});

	it('accounts for a kind a provider backs, so no dev service stands in', () => {
		expect(
			stageProviderNotes(
				workspace({ prod: { provider: 's3' } }) as never,
				'prod',
			).objects?.accounted,
		).toBe(true);
	});
});
