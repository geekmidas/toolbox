/**
 * The deploy state's size in SSM: a busy stage's document is stored
 * compressed in a tier that holds it, is read back in either form, and one
 * that cannot fit is refused before a deploy changes anything — or, at a
 * write, with a named error instead of the SDK's.
 *
 * The emulator stores any size in any tier, so the SSM limits AWS enforces —
 * 4 KB on the standard tier, 8 KB on the advanced one, which Intelligent-
 * Tiering moves to — are put in front of it here, answering a put over the
 * limit as AWS does. Everything else reaches the emulator.
 *
 * Requires the emulator: docker compose up -d localstack
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import {
	GetParameterCommand,
	PutParameterCommand,
	SSMClient,
} from '@aws-sdk/client-ssm';
import { HttpResponse, http, passthrough } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LOCALSTACK_URL } from '../../../../testkit/test/ports';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import {
	loadComposeApp,
	writeComposeApp,
} from '../../compose/__tests__/__helpers__/composeApp';
import { defineTarget } from '../../target/define';
import type { NormalizedWorkspace } from '../../workspace/types';
import type { DeployEvent } from '../events';
import { runDeploy } from '../orchestrate';
import { packSsmBody, SSM_MAX_BYTES, SSMStateStore } from '../SSMStateStore';
import {
	COMPRESSED_PREFIX,
	encodeDocument,
	STATE_HEADROOM_BYTES,
	StateRejectedBySsm,
	StateTooLargeForSsm,
	StateVersionConflict,
} from '../StateStore';
import {
	busyDocument,
	busyResources,
	busyState,
} from './__helpers__/busyStage';

const aws = {
	region: 'us-east-1',
	endpoint: LOCALSTACK_URL,
	credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};
const STAGE = 'production';

/** SSM's value limits, as AWS answers a put past them. */
const server = setupServer(
	http.post(`${LOCALSTACK_URL}/`, async ({ request }) => {
		if (request.headers.get('x-amz-target') !== 'AmazonSSM.PutParameter') {
			return passthrough();
		}
		const put = (await request.clone().json()) as {
			Value: string;
			Tier?: string;
		};
		const standard = !put.Tier || put.Tier === 'Standard';
		const limit = standard ? 4096 : 8192;
		if (put.Value.length <= limit) return passthrough();
		return HttpResponse.json(
			{
				__type: 'ValidationException',
				message: standard
					? 'Standard tier parameters support a maximum parameter value of 4096 characters. To create a larger parameter value, upgrade the parameter to use the advanced-parameter tier.'
					: 'Advanced tier parameters support a maximum parameter value of 8192 characters.',
			},
			{
				status: 400,
				headers: { 'content-type': 'application/x-amz-json-1.1' },
			},
		);
	}),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());

const ssm = new SSMClient(aws);
let workspaceName: string;
const open = () => new SSMStateStore(workspaceName, new SSMClient(aws));
const parameter = async (leaf = 'state') =>
	(
		await ssm.send(
			new GetParameterCommand({
				Name: `/gkm/${workspaceName}/${STAGE}/${leaf}`,
				WithDecryption: true,
			}),
		)
	).Parameter!;

/** The busy stage written as deploys write it: the state, then each record. */
async function writeBusyStage(store: SSMStateStore): Promise<string> {
	let version = await store.write(STAGE, busyState(STAGE), {
		expectedVersion: null,
	});
	for (const record of busyResources(STAGE)) {
		version = await store.putResource(STAGE, record, {
			expectedVersion: version,
		});
	}
	return version;
}

describe('SSMStateStore with a busy stage', { timeout: 60_000 }, () => {
	beforeEach(() => {
		// Its own parameters per test: the emulator outlives the suite.
		workspaceName = `ssm-size-${randomUUID().slice(0, 8)}`;
	});

	it('measures: the busy document is far past 8 KB, and fits compressed', () => {
		const body = encodeDocument(busyDocument(STAGE));
		const packed = packSsmBody(body);

		expect(Buffer.byteLength(body)).toBeGreaterThan(SSM_MAX_BYTES);
		expect(packed.startsWith(COMPRESSED_PREFIX)).toBe(true);
		expect(packed.length + STATE_HEADROOM_BYTES).toBeLessThanOrEqual(
			SSM_MAX_BYTES,
		);
	});

	it('writes and reads a busy stage, stored compressed', async () => {
		const store = open();
		await writeBusyStage(store);

		const stored = await parameter();
		expect(stored.Value!.startsWith(COMPRESSED_PREFIX)).toBe(true);
		expect(stored.Value!.length).toBeLessThanOrEqual(SSM_MAX_BYTES);

		const read = await open().read(STAGE);
		expect(read?.state).toEqual(busyState(STAGE));
		expect(Object.keys(read?.resources ?? {})).toEqual(
			busyResources(STAGE).map((r) => r.key),
		);
	});

	it('refuses the second of two writers based on the same version', async () => {
		const version = await writeBusyStage(open());
		const first = open();
		const second = open();

		await first.write(STAGE, busyState(STAGE), { expectedVersion: version });
		await expect(
			second.write(STAGE, busyState(STAGE), { expectedVersion: version }),
		).rejects.toBeInstanceOf(StateVersionConflict);
	});

	it('reads a document stored uncompressed, as every write before was', async () => {
		// A young stage's: one app, two releases, a few writes — under 4 KB,
		// the standard tier, as JSON.
		const document = busyDocument(STAGE);
		const api = document.state.releases!.api!;
		document.resources = {};
		document.history = document.history.slice(0, 3);
		document.state.releases = {
			api: { ...api, history: api.history.slice(0, 2) },
		};
		const body = encodeDocument(document);
		expect(body.length).toBeLessThanOrEqual(4096);
		await ssm.send(
			new PutParameterCommand({
				Name: `/gkm/${workspaceName}/${STAGE}/state`,
				Value: body,
				Type: 'SecureString',
			}),
		);

		const read = await open().read(STAGE);
		expect(read?.state).toEqual(document.state);
		expect(read?.history).toEqual(document.history);
	});

	it('names the refusal of a write SSM will not hold', async () => {
		const store = open();
		const version = await writeBusyStage(store);

		// A record no compression shrinks, past what the advanced tier holds.
		const error = await store
			.putResource(
				STAGE,
				{
					key: 'blob:noise',
					type: 'blob',
					status: 'ready',
					data: { noise: randomBytes(3000).toString('base64') },
				},
				{ expectedVersion: version },
			)
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(StateRejectedBySsm);
		expect((error as StateRejectedBySsm).message).toMatch(
			/what it released is running now/,
		);
		expect((error as StateRejectedBySsm).message).toMatch(
			/state: \{ provider: 's3'/,
		);
		// The state SSM holds is the last one it accepted.
		expect((await open().read(STAGE))?.version).toBe(version);
	});
});

describe('a deploy whose state would not fit SSM', { timeout: 120_000 }, () => {
	let dir: string;
	let workspace: NormalizedWorkspace;

	beforeAll(async () => {
		dir = realpathSync(await createTempDir('gkm-ssm-size-'));
		writeComposeApp(dir, { registry: 'registry.example.com/acme' });
		({ workspace } = await loadComposeApp(dir));
	}, 60_000);

	afterAll(async () => {
		await cleanupDir(dir);
	});

	it('is refused before the target is asked anything', async () => {
		workspaceName = `ssm-size-${randomUUID().slice(0, 8)}`;
		// A stage that outgrew SSM: every app with buckets and records of its
		// own. Planted directly — past its limit, AWS would never have taken it.
		server.use(http.post(`${LOCALSTACK_URL}/`, () => passthrough()));
		await ssm.send(
			new PutParameterCommand({
				Name: `/gkm/${workspaceName}/${STAGE}/state`,
				Value: encodeDocument(busyDocument(STAGE, { perApp: true })),
				Type: 'SecureString',
			}),
		);
		server.resetHandlers();

		const ran: string[] = [];
		const target = defineTarget<undefined, undefined>({
			name: 'stand-in',
			runtime: 'server',
			capabilities: { rollback: false, migrations: 'target', images: true },
			async validate() {
				ran.push('validate');
			},
			async build() {
				ran.push('build');
			},
			async release() {
				ran.push('release');
			},
			async plan() {
				ran.push('plan');
			},
			result: (ctx) => ({
				apps: [],
				projectId: '',
				successCount: 0,
				failedCount: 0,
				stage: ctx.stage,
				identity: ctx.identity.key,
				tag: ctx.tag,
				dryRun: ctx.dryRun,
				environmentId: '',
				skipped: [],
				urls: {},
				changes: [],
			}),
		});
		const store = open();
		const events: DeployEvent[] = [];

		const error = await runDeploy(
			{ ...workspace, state: { provider: store } },
			{ stage: STAGE, target: 'stand-in' },
			{
				emit: (event) => events.push(event),
				credentials: { get: async () => undefined },
				dryRun: false,
				targets: { 'stand-in': target },
			},
		).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(StateTooLargeForSsm);
		const tooLarge = error as StateTooLargeForSsm;
		expect(tooLarge.limit).toBe(SSM_MAX_BYTES);
		expect(tooLarge.bytes).toBeGreaterThan(
			SSM_MAX_BYTES - STATE_HEADROOM_BYTES,
		);
		expect(tooLarge.message).toMatch(/Nothing was deployed/);
		expect(tooLarge.message).toMatch(/gkm state:push --stage production/);
		expect(ran).toEqual([]);
		expect(events).toContainEqual(
			expect.objectContaining({ type: 'phase.failed', phase: 'validate' }),
		);
		// The lock was released: the next run is not refused for it.
		await (await store.lock(STAGE)).release();
	});
});
