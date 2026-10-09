import { describe, expect, it } from 'vitest';
import {
	AllowDevServicesTakesNoValue,
	assertDevServicesFlag,
	externalServices,
} from '../devServices';

describe('--allow-dev-services on a command line', () => {
	it('is a switch', () => {
		expect(() =>
			assertDevServicesFlag([
				'deploy',
				'--stage',
				'prod',
				'--allow-dev-services',
			]),
		).not.toThrow();
		expect(() =>
			assertDevServicesFlag([
				'compose',
				'--allow-dev-services',
				'--stage',
				'prod',
			]),
		).not.toThrow();
	});

	it('refuses the list it used to take, saying why', () => {
		expect(() =>
			assertDevServicesFlag([
				'deploy',
				'--allow-dev-services',
				'minio,mailpit',
			]),
		).toThrow(AllowDevServicesTakesNoValue);
		expect(() =>
			assertDevServicesFlag(['deploy', '--allow-dev-services=minio']),
		).toThrow("--allow-dev-services takes no value (it was given 'minio')");
	});
});

describe('what --allow-dev-services stands in for', () => {
	const declarations = [
		{ id: 'Mail', kind: 'email' as const },
		{ id: 'Uploads', kind: 'objects' as const },
		{ id: 'UploadsServer', kind: 'file-server' as const, of: 'Uploads' },
	];

	it('every construct the stage does not account for', () => {
		const services = externalServices({
			stage: 'preview',
			declarations,
			supplied: {},
			allow: true,
		});
		expect(services).toEqual({
			missing: [],
			minio: ['Uploads'],
			mailpit: ['Mail'],
		});
	});

	it('nothing the stage set a key for', () => {
		const services = externalServices({
			stage: 'preview',
			declarations,
			supplied: { UPLOADS_URL: 's3://mine?region=eu-west-1' },
			allow: true,
		});
		expect(services.minio).toEqual([]);
		expect(services.mailpit).toEqual(['Mail']);
		expect(services.missing.map((m) => m.key)).toEqual(['UPLOADS_SERVER_URL']);
	});

	it('nothing a provider backs, whose missing keys say what creates them', () => {
		const services = externalServices({
			stage: 'preview',
			declarations,
			supplied: {},
			allow: true,
			providers: {
				objects: {
					accounted: true,
					hint: 'the deploy (gkm deploy --stage preview) creates it',
				},
			},
		});
		expect(services.minio).toEqual([]);
		expect(services.mailpit).toEqual(['Mail']);
		expect(services.missing).toEqual([
			expect.objectContaining({
				key: 'UPLOADS_URL',
				hint: 'the deploy (gkm deploy --stage preview) creates it',
			}),
			expect.objectContaining({ key: 'UPLOADS_SERVER_URL' }),
		]);
		expect(services.missing[0]).not.toHaveProperty('service');
	});

	it('nothing at all without the flag', () => {
		const services = externalServices({
			stage: 'preview',
			declarations,
			supplied: {},
			allow: false,
		});
		expect(services.minio).toEqual([]);
		expect(services.mailpit).toEqual([]);
		expect(services.missing).toHaveLength(4);
	});
});
