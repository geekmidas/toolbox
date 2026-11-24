import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IAMClient } from '@aws-sdk/client-iam';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { googleClient } from '../../providers/google/client';
import { deployGithubCommand, type Gh } from '../github';
import {
	deployAccountId,
	ensureGoogleTrust,
	GoogleCiGrantTargetMissing,
	GoogleCiProjectMissing,
	type GoogleTrustPlan,
	type IamPolicy,
	principalFor,
	WORKLOAD_IDENTITY_USER,
	wifProviderId,
	withMemberRoles,
	withPoolSubject,
} from '../githubGoogle';

/**
 * `gkm deploy:github`'s Google side, against a fake of the APIs it calls —
 * Resource Manager, Service Usage and IAM — served through MSW, so every
 * request is the one the command sends.
 */

const PROJECT = 'shop-maps';
const NUMBER = '424242';
const SUBJECT = 'repo:acme/shop:environment:prod';
const EMAIL = `gkm-github-prod@${PROJECT}.iam.gserviceaccount.com`;
const PLAY = `shop-play@${PROJECT}.iam.gserviceaccount.com`;

interface Resource {
	name: string;
	state: string;
	attributeCondition?: string;
	attributeMapping?: Record<string, string>;
}

/** What Google holds, as the fake answers it. */
const google = {
	projects: new Map<string, string>(),
	enabled: new Set<string>(),
	pools: new Map<string, Resource>(),
	providers: new Map<string, Resource>(),
	accounts: new Set<string>(),
	accountPolicies: new Map<string, IamPolicy>(),
	projectPolicies: new Map<string, IamPolicy>(),
	writes: [] as string[],
};

function reset() {
	google.projects = new Map([[PROJECT, NUMBER]]);
	google.enabled = new Set();
	google.pools = new Map();
	google.providers = new Map();
	google.accounts = new Set([PLAY]);
	google.accountPolicies = new Map();
	google.projectPolicies = new Map([
		[
			PROJECT,
			{
				etag: 'e1',
				bindings: [{ role: 'roles/owner', members: ['user:owner@acme.dev'] }],
			},
		],
	]);
	google.writes = [];
}

const done = { name: 'operations/op', done: true };
const missing = () =>
	HttpResponse.json({ error: { message: 'not found' } }, { status: 404 });

async function answer(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const path = decodeURIComponent(url.pathname);
	const body = request.method === 'GET' ? undefined : await request.json();
	const write = (what: string) => google.writes.push(what);

	if (url.host === 'cloudresourcemanager.googleapis.com') {
		const [, id, verb] =
			path.match(/^\/v3\/projects\/([^/:]+)(?::(\w+))?$/) ?? [];
		const number = google.projects.get(id!);
		if (!number) return missing();
		if (!verb) return HttpResponse.json({ name: `projects/${number}` });
		if (verb === 'getIamPolicy') {
			return HttpResponse.json(google.projectPolicies.get(id!) ?? {});
		}
		write(`project policy ${id}`);
		google.projectPolicies.set(id!, (body as { policy: IamPolicy }).policy);
		return HttpResponse.json({});
	}

	if (url.host === 'serviceusage.googleapis.com') {
		const [, service] = path.match(/\/services\/([^/:]+):enable$/) ?? [];
		google.enabled.add(service!);
		return HttpResponse.json(done);
	}

	// IAM.
	const pools = `/v1/projects/${PROJECT}/locations/global/workloadIdentityPools`;
	if (path.startsWith(`${pools}/github/providers`)) {
		const rest = path.slice(`${pools}/github/providers`.length);
		const id = url.searchParams.get('workloadIdentityPoolProviderId');
		if (request.method === 'POST' && rest === '' && id) {
			write(`create provider ${id}`);
			google.providers.set(id, {
				name: id,
				state: 'ACTIVE',
				...(body as object),
			});
			return HttpResponse.json(done);
		}
		const name = rest.replace(/^\//, '').replace(/:undelete$/, '');
		const provider = google.providers.get(name);
		if (!provider) return missing();
		if (request.method === 'GET') return HttpResponse.json(provider);
		if (rest.endsWith(':undelete')) {
			write(`undelete provider ${name}`);
			provider.state = 'ACTIVE';
			return HttpResponse.json(done);
		}
		write(`patch provider ${name}`);
		Object.assign(provider, body);
		return HttpResponse.json(done);
	}
	if (path.startsWith(pools)) {
		const rest = path.slice(pools.length);
		const id = url.searchParams.get('workloadIdentityPoolId');
		if (request.method === 'POST' && rest === '' && id) {
			write(`create pool ${id}`);
			google.pools.set(id, { name: id, state: 'ACTIVE' });
			return HttpResponse.json(done);
		}
		const name = rest.replace(/^\//, '').replace(/:undelete$/, '');
		const pool = google.pools.get(name);
		if (!pool) return missing();
		if (rest.endsWith(':undelete')) {
			write(`undelete pool ${name}`);
			pool.state = 'ACTIVE';
			return HttpResponse.json(done);
		}
		return HttpResponse.json(pool);
	}
	const [, account, verb] =
		path.match(
			/^\/v1\/projects\/[^/]+\/serviceAccounts\/([^/:]+)(?::(\w+))?$/,
		) ?? [];
	if (account) {
		if (!google.accounts.has(account)) return missing();
		if (!verb) return HttpResponse.json({ email: account });
		if (verb === 'getIamPolicy') {
			return HttpResponse.json(google.accountPolicies.get(account) ?? {});
		}
		write(`account policy ${account}`);
		google.accountPolicies.set(account, (body as { policy: IamPolicy }).policy);
		return HttpResponse.json({});
	}
	if (path === `/v1/projects/${PROJECT}/serviceAccounts`) {
		const { accountId } = body as { accountId: string };
		const email = `${accountId}@${PROJECT}.iam.gserviceaccount.com`;
		write(`create account ${email}`);
		google.accounts.add(email);
		return HttpResponse.json({ email });
	}
	return HttpResponse.json(
		{ error: { message: `unexpected ${path}` } },
		{
			status: 501,
		},
	);
}

const server = setupServer(
	http.all(/^https:\/\/[a-z]+\.googleapis\.com\//, ({ request }) =>
		answer(request),
	),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(reset);
afterEach(() => server.resetHandlers());

const clients = {
	bare: googleClient('token'),
	project: googleClient('token', PROJECT),
};

const plan = (overrides: Partial<GoogleTrustPlan> = {}): GoogleTrustPlan => ({
	project: PROJECT,
	providerId: wifProviderId('acme/shop'),
	condition: "assertion.repository == 'acme/shop'",
	account: 'gkm-github-prod',
	email: EMAIL,
	grants: [
		{ project: PROJECT, role: 'roles/serviceusage.apiKeysAdmin' },
		{ project: PROJECT, role: 'roles/browser' },
	],
	...overrides,
});

const trust = (overrides: Partial<GoogleTrustPlan> = {}, subject = SUBJECT) =>
	ensureGoogleTrust(
		clients,
		{ stage: 'prod', plan: plan(overrides), subject },
		{ intervalMs: 0 },
	);

const rolesOf = (policy: IamPolicy | undefined, member: string) =>
	(policy?.bindings ?? [])
		.filter((b) => b.members.includes(member))
		.map((b) => b.role)
		.sort();

describe('the names deploy:github gives Google', () => {
	it('keeps a provider id within Google’s 32 characters', () => {
		expect(
			wifProviderId('acme-industries/a-very-long-repository-name'),
		).toMatch(/^[a-z][a-z0-9-]{2,30}[a-z0-9]$/);
	});

	it('tells apart two repositories that share a long prefix', () => {
		expect(wifProviderId('acme/storefront-mobile-app-ios')).not.toBe(
			wifProviderId('acme/storefront-mobile-app-android'),
		);
	});

	it('names the deploy account after the stage', () => {
		expect(deployAccountId('Production')).toBe('gkm-github-production');
	});
});

describe('withMemberRoles', () => {
	const member = `serviceAccount:${EMAIL}`;

	it('adds what is missing and takes off what is no longer needed', () => {
		const result = withMemberRoles(
			{
				bindings: [
					{ role: 'roles/browser', members: ['user:a@acme.dev'] },
					{ role: 'roles/editor', members: [member, 'user:b@acme.dev'] },
					{ role: 'roles/viewer', members: [member] },
				],
			},
			member,
			['roles/browser', 'roles/serviceusage.apiKeysAdmin'],
		);

		expect({
			added: result.added,
			removed: result.removed,
			bindings: result.policy.bindings,
		}).toEqual({
			added: ['roles/browser', 'roles/serviceusage.apiKeysAdmin'],
			removed: ['roles/editor', 'roles/viewer'],
			bindings: [
				{ role: 'roles/browser', members: ['user:a@acme.dev', member] },
				{ role: 'roles/editor', members: ['user:b@acme.dev'] },
				{ role: 'roles/serviceusage.apiKeysAdmin', members: [member] },
			],
		});
	});

	it('leaves a conditional binding as it is', () => {
		const conditional = {
			role: 'roles/viewer',
			members: [member],
			condition: { expression: 'true' },
		};

		const result = withMemberRoles({ bindings: [conditional] }, member, []);

		expect(result.policy.bindings).toEqual([conditional]);
	});
});

describe('withPoolSubject', () => {
	const pool = `projects/${NUMBER}/locations/global/workloadIdentityPools/github`;

	it('replaces the stage’s previous subject, and keeps other members', () => {
		const result = withPoolSubject(
			{
				bindings: [
					{
						role: WORKLOAD_IDENTITY_USER,
						members: [
							principalFor(NUMBER, 'repo:acme/shop:environment:old'),
							'user:admin@acme.dev',
						],
					},
				],
			},
			pool,
			principalFor(NUMBER, SUBJECT),
		);

		expect({
			replaced: result.replaced,
			members: result.policy.bindings?.[0]?.members,
		}).toEqual({
			replaced: ['repo:acme/shop:environment:old'],
			members: ['user:admin@acme.dev', principalFor(NUMBER, SUBJECT)],
		});
	});

	it('changes nothing when the subject is already the one trusted', () => {
		const policy = {
			bindings: [
				{
					role: WORKLOAD_IDENTITY_USER,
					members: [principalFor(NUMBER, SUBJECT)],
				},
			],
		};

		expect(
			withPoolSubject(policy, pool, principalFor(NUMBER, SUBJECT)).changed,
		).toBe(false);
	});
});

describe('ensureGoogleTrust', () => {
	it('sets up the pool, the provider, the account and its roles', async () => {
		const outcome = await trust();

		expect({
			provider: outcome.provider,
			serviceAccount: outcome.serviceAccount,
			enabled: [...google.enabled].sort(),
			condition: google.providers.get(wifProviderId('acme/shop'))
				?.attributeCondition,
			trusted: google.accountPolicies.get(EMAIL)?.bindings,
			roles: rolesOf(
				google.projectPolicies.get(PROJECT),
				`serviceAccount:${EMAIL}`,
			),
		}).toEqual({
			provider: `projects/${NUMBER}/locations/global/workloadIdentityPools/github/providers/${wifProviderId('acme/shop')}`,
			serviceAccount: EMAIL,
			enabled: [
				'iam.googleapis.com',
				'iamcredentials.googleapis.com',
				'sts.googleapis.com',
			],
			condition: "assertion.repository == 'acme/shop'",
			trusted: [
				{
					role: WORKLOAD_IDENTITY_USER,
					members: [principalFor(NUMBER, SUBJECT)],
				},
			],
			roles: ['roles/browser', 'roles/serviceusage.apiKeysAdmin'],
		});
	});

	it('changes nothing on a second run', async () => {
		await trust();
		google.writes = [];

		const second = await trust();

		expect({ writes: google.writes, changes: second.changes }).toEqual({
			writes: [],
			changes: [],
		});
	});

	it('moves the trust to a new subject, and says from what', async () => {
		await trust({}, 'repo:acme/shop:environment:old');

		const outcome = await trust();

		expect(outcome.changes).toEqual([
			`trust repo:acme/shop:environment:old → ${SUBJECT}`,
		]);
	});

	it('takes off a role no provider needs any more', async () => {
		await trust();

		await trust({
			grants: [{ project: PROJECT, role: 'roles/browser' }],
		});

		expect(
			rolesOf(google.projectPolicies.get(PROJECT), `serviceAccount:${EMAIL}`),
		).toEqual(['roles/browser']);
	});

	it('puts back a condition someone changed on the provider', async () => {
		await trust();
		const provider = google.providers.get(wifProviderId('acme/shop'))!;
		provider.attributeCondition = 'true';

		await trust();

		expect(provider.attributeCondition).toBe(
			"assertion.repository == 'acme/shop'",
		);
	});

	it('brings back a deleted pool', async () => {
		google.pools.set('github', { name: 'github', state: 'DELETED' });

		await trust();

		expect(google.pools.get('github')?.state).toBe('ACTIVE');
	});

	it('grants a role on one service account, not the project', async () => {
		await trust({
			grants: [
				{
					project: PROJECT,
					role: 'roles/iam.serviceAccountViewer',
					serviceAccount: PLAY,
				},
			],
		});

		expect({
			account: rolesOf(
				google.accountPolicies.get(PLAY),
				`serviceAccount:${EMAIL}`,
			),
			project: rolesOf(
				google.projectPolicies.get(PROJECT),
				`serviceAccount:${EMAIL}`,
			),
		}).toEqual({ account: ['roles/iam.serviceAccountViewer'], project: [] });
	});

	it('says to deploy first when the account to grant on is not there', async () => {
		google.accounts.delete(PLAY);

		await expect(
			trust({
				grants: [
					{
						project: PROJECT,
						role: 'roles/iam.serviceAccountViewer',
						serviceAccount: PLAY,
					},
				],
			}),
		).rejects.toThrow(GoogleCiGrantTargetMissing);
	});

	it('says to deploy first, or name the project, when there is none', async () => {
		google.projects.clear();

		await expect(trust()).rejects.toThrow(GoogleCiProjectMissing);
	});
});

describe('deploy:github for a stage that uses Google', () => {
	let root: string;
	let home: string;
	const originalHome = process.env.HOME;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'gkm-github-google-'));
		home = mkdtempSync(join(tmpdir(), 'gkm-home-'));
		process.env.HOME = home;
		writeFileSync(
			join(root, 'gkm.config.ts'),
			`import { defineWorkspace } from '@geekmidas/cli/config';

export default defineWorkspace({
  name: 'shop',
  constructs: './src/constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['staging', 'prod'], protected: ['prod'] },
  deploy: {
    default: 'compose',
    maps: { prod: { provider: 'google', project: '${PROJECT}' } },
  },
});
`,
		);
		mkdirSync(join(home, '.gkm', 'shop'), { recursive: true });
		writeFileSync(join(home, '.gkm', 'shop', 'prod.key'), 'a1b2c3\n');
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	function recordingGh() {
		const calls: string[][] = [];
		const gh: Gh = (args) => {
			if (args[0] === 'api' && args[1] !== '--method') {
				return JSON.stringify({ use_default: true });
			}
			calls.push(args);
			return '';
		};
		return { gh, calls };
	}

	/** An AWS client that fails the test if the command reaches AWS. */
	const noAws = {
		send: async () => {
			throw new Error('reached AWS');
		},
	} as unknown as IAMClient;

	it('sets up Google and hands GitHub its two variables, with no AWS', async () => {
		const { gh, calls } = recordingGh();

		const result = await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop' },
			{
				gh,
				iam: noAws,
				cwd: root,
				google: { token: async () => 'token' },
				googleIntervalMs: 0,
			},
		);

		expect({
			roleArn: result.roleArn,
			variables: calls
				.filter((args) => args[0] === 'variable')
				.map((args) => [args[2], args.at(-1)]),
			roles: rolesOf(
				google.projectPolicies.get(PROJECT),
				`serviceAccount:${EMAIL}`,
			),
		}).toEqual({
			roleArn: undefined,
			variables: [
				[
					'GCP_WORKLOAD_IDENTITY_PROVIDER',
					`projects/${NUMBER}/locations/global/workloadIdentityPools/github/providers/${wifProviderId('acme/shop')}`,
				],
				['GCP_SERVICE_ACCOUNT', EMAIL],
			],
			roles: [
				'roles/browser',
				'roles/serviceusage.apiKeysAdmin',
				'roles/serviceusage.serviceUsageAdmin',
			],
		});
	});

	it('changes nothing in Google on --dry-run', async () => {
		const { gh, calls } = recordingGh();

		await deployGithubCommand(
			{ stage: 'prod', repo: 'acme/shop', dryRun: true },
			{ gh, iam: noAws, cwd: root, google: { token: async () => 'token' } },
		);

		expect({ writes: google.writes, gh: calls }).toEqual({
			writes: [],
			gh: [],
		});
	});

	it('leaves Google out for a stage that does not use it', async () => {
		const { gh } = recordingGh();
		const signIn = vi.fn(async () => 'token');

		await deployGithubCommand(
			{ stage: 'staging', repo: 'acme/shop', dryRun: true },
			{ gh, cwd: root, google: { token: signIn } },
		);

		expect(signIn).not.toHaveBeenCalled();
	});
});
