import { realpathSync } from 'node:fs';
import type { ConstructManifest } from '@geekmidas/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { withGeneratedSecrets } from '../../deploy/generated';
import { deployIdentity } from '../../deploy/identity';
import {
	NEXT_ACTIONS_KEY,
	NEXT_DEPLOYMENT_ID_KEY,
} from '../../deploy/nextRelease';
import { TEST_CREDENTIALS } from '../../reconcile/__tests__/__helpers__/credentials';
import { processEnvKeys } from '../../reconcile/apps';
import { isStackKey } from '../../secrets/stackKeys';
import { initStageSecrets } from '../../secrets/storage';
import type { StageSecrets } from '../../secrets/types';
import type { NormalizedWorkspace } from '../../workspace/types';
import { type ComposeStack, composeStack, type StackInput } from '../stack';
import { loadComposeApp, writeComposeApp } from './__helpers__/composeApp';

/**
 * #508: a Next site's build is tagged with its release, and made — and served
 * — with one server actions key per stage, so a tab opened before a deploy
 * neither loads chunks the new build lacks nor submits actions it cannot find.
 */

let dir: string;
let workspace: NormalizedWorkspace;
let manifest: ConstructManifest;
let background: Record<string, string[]>;

beforeAll(async () => {
	dir = realpathSync(await createTempDir('gkm-compose-next-release-'));
	writeComposeApp(dir, {
		registry: 'registry.example.com/acme',
		siteVariant: 'next',
	});
	({ workspace, manifest, background } = await loadComposeApp(dir));
});

afterAll(async () => {
	await cleanupDir(dir);
});

/** A deployed stage's secrets, as its first deploy generates them. */
function generated(stage: string): StageSecrets {
	const { secrets } = withGeneratedSecrets(
		{
			...initStageSecrets(stage),
			custom: {
				AUTH_SECRET: 'the-signing-secret',
				REDIS_PASSWORD: 'the-redis-password',
			},
		},
		manifest,
	);
	return secrets;
}

function deployed(
	stage: string,
	secrets: StageSecrets,
	overrides: Partial<StackInput> = {},
): ComposeStack {
	return composeStack({
		workspace,
		manifest,
		background,
		stage,
		identity: deployIdentity(workspace, stage),
		images: {
			mode: 'build',
			tag: 'abc1234',
			registry: 'registry.example.com/acme',
		},
		secrets,
		ports: {},
		...overrides,
	});
}

const app = (s: ComposeStack, name: string) =>
	s.apps.find((candidate) => candidate.name === name)!;

describe("a Next site's release on a deployed stage", () => {
	let production: StageSecrets;
	let key: string;
	beforeAll(() => {
		production = generated('production');
		key = production.custom[NEXT_ACTIONS_KEY]!;
	});

	it('generates one server actions key for the stage: 32 bytes, base64', () => {
		expect(Buffer.from(key, 'base64')).toHaveLength(32);
		expect(Buffer.from(key, 'base64').toString('base64')).toBe(key);
	});

	it('builds the site with its release as the deployment id, and the key', () => {
		const args = deployed('production', production).compose.services.web?.build
			?.args;

		expect(args).toMatchObject({
			// The image's own tag: unique to the commit and the stage.
			[NEXT_DEPLOYMENT_ID_KEY]: 'abc1234-production',
			[NEXT_ACTIONS_KEY]: key,
		});
	});

	it('tags each release with its own commit, and keeps the key', () => {
		const next = deployed('production', production, {
			images: {
				mode: 'build',
				tag: 'def5678',
				registry: 'registry.example.com/acme',
			},
		}).compose.services.web?.build?.args;

		expect(next?.[NEXT_DEPLOYMENT_ID_KEY]).toBe('def5678-production');
		expect(next?.[NEXT_ACTIONS_KEY]).toBe(key);
	});

	it("declares both in the site's Dockerfile, in the builder stage alone", () => {
		const s = deployed('production', production);
		const dockerfile = s.dockerfiles[app(s, 'web').build!.dockerfile]!;
		const runner = dockerfile.slice(dockerfile.indexOf('AS runner'));

		expect(dockerfile).toContain('.next/standalone');
		expect(dockerfile).toContain(`ARG ${NEXT_DEPLOYMENT_ID_KEY}=""`);
		expect(dockerfile).toContain(`ARG ${NEXT_ACTIONS_KEY}=""`);
		expect(runner).not.toContain(NEXT_ACTIONS_KEY);
		expect(runner).not.toContain(NEXT_DEPLOYMENT_ID_KEY);
	});

	it("hands the key to the site's server at runtime", () => {
		const s = deployed('production', production);

		expect(app(s, 'web').env?.[NEXT_ACTIONS_KEY]).toBe(key);
	});

	it('hands the key to no other app or worker', () => {
		const s = deployed('production', production);
		const others = JSON.stringify([
			...s.apps.filter((a) => a.name !== 'web').map((a) => a.env),
			...s.workers.map((w) => w.env),
		]);

		expect(others).not.toContain(NEXT_ACTIONS_KEY);
		expect(others).not.toContain(key);
	});

	it('is a stack key, which no process is handed as the stage’s own', () => {
		expect(isStackKey(NEXT_ACTIONS_KEY)).toBe(true);
		expect(
			processEnvKeys(manifest, { app: 'api' }, [NEXT_ACTIONS_KEY, 'STRIPE']),
		).not.toContain(NEXT_ACTIONS_KEY);
	});

	it('differs between stages', () => {
		const staging = generated('staging');

		expect(staging.custom[NEXT_ACTIONS_KEY]).toBeDefined();
		expect(staging.custom[NEXT_ACTIONS_KEY]).not.toBe(key);
	});

	it('is never replaced by a later deploy', () => {
		const { secrets, generated: again } = withGeneratedSecrets(
			production,
			manifest,
		);

		expect(again).not.toContain(NEXT_ACTIONS_KEY);
		expect(secrets.custom[NEXT_ACTIONS_KEY]).toBe(key);
	});
});

describe('a stage with no Next site', () => {
	it('generates no server actions key', () => {
		const vite = {
			...manifest,
			Web: { ...manifest.Web, variant: 'static' },
		} as ConstructManifest;

		const { secrets, generated: made } = withGeneratedSecrets(
			initStageSecrets('production'),
			vite,
		);

		expect(made).not.toContain(NEXT_ACTIONS_KEY);
		expect(secrets.custom).not.toHaveProperty(NEXT_ACTIONS_KEY);
	});
});

describe('the local stage', () => {
	it('still tags the build with its release, with no key to hand it', () => {
		const s = composeStack({
			workspace,
			manifest,
			background,
			stage: 'development',
			identity: deployIdentity(workspace, 'development'),
			images: { mode: 'build', tag: 'abc1234' },
			ports: { https: 8443, http: 8080 },
			localCredentials: TEST_CREDENTIALS,
		});
		const args = s.compose.services.web?.build?.args;

		expect(args?.[NEXT_DEPLOYMENT_ID_KEY]).toBe('abc1234-development');
		expect(args).not.toHaveProperty(NEXT_ACTIONS_KEY);
		expect(app(s, 'web').env).not.toHaveProperty(NEXT_ACTIONS_KEY);
	});
});
