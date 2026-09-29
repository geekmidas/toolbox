import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	cleanupDir,
	createSurfaceFile,
	createTempDir,
	createTestFile,
} from '../../__tests__/test-helpers';
import { type ConstructSource, discover } from '../../reconcile/discover.js';
import { ownersContext } from '../owners';

describe('ownersContext', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await createTempDir('owners-');
	});

	afterEach(async () => {
		await cleanupDir(dir);
	});

	async function discovered() {
		const sources: Record<string, ConstructSource> = {};
		const declared = await discover({
			patterns: ['src/constructs/**/*.ts'],
			cwd: dir,
			bustCache: true,
			sources,
		});

		return { declared, sources };
	}

	// `gkm dev` built its entry without this and threw "No owner to take a
	// logger and an environment parser from" for every app.
	it('gives the entry the module its surface is exported from', async () => {
		const file = await createSurfaceFile(dir);

		const context = ownersContext({
			...(await discovered()),
			workspaceRoot: dir,
			appRoot: dir,
		});

		expect(context.surface).toMatchObject({
			id: 'Test',
			module: { specifier: file, exportName: 'api' },
		});
		expect(context.owners).toEqual({
			Test: { specifier: file, exportName: 'api' },
		});
	});

	it('serves the surface whose path is the app being built', async () => {
		await createTestFile(
			dir,
			'src/constructs/surfaces.ts',
			`import { RestApi } from '@geekmidas/constructs/rest-api';

export const admin = new RestApi('Admin', { path: 'apps/admin', defaultAuthorizer: 'none' });
export const api = new RestApi('Api', { path: 'apps/api', defaultAuthorizer: 'none' });
`,
		);

		const context = ownersContext({
			...(await discovered()),
			workspaceRoot: dir,
			appRoot: join(dir, 'apps/api'),
		});

		expect(context.surface?.id).toBe('Api');
		expect(context.surface?.module?.exportName).toBe('api');
	});
});
