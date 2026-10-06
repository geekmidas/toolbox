import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { storeDokployCredentials } from '../../auth/credentials';
import { run, runOutput } from '../../run';
import { deployCommand } from '../index';
import {
	type Dokploy,
	ENDPOINT,
	emptyDokploy,
	serveDokploy,
	writeShopWorkspace,
} from './__helpers__/dokployStandIn';

vi.mock('../../run', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../run')>()),
	run: vi.fn(),
	runOutput: vi.fn(),
}));

const STAGE = 'production';

let dokploy: Dokploy;
const server = setupServer();

describe('gkm deploy', () => {
	let root: string;
	let home: string;
	let cwd: string;
	let out: string[];

	/** What was printed, with what differs between runs made stable. */
	const printed = () =>
		out
			.join('\n')
			.replaceAll(root, '<root>')
			.replace(/\b(proj|env|app|dom|reg|pg)_\d+\b/g, '$1_<id>');

	beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
	afterAll(() => server.close());

	beforeEach(async () => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-headless-')));
		home = mkdtempSync(join(tmpdir(), 'gkm-headless-home-'));
		vi.stubEnv('HOME', home);
		vi.stubEnv('GKM_HOME', undefined);
		vi.stubEnv('DOKPLOY_API_TOKEN', undefined);
		vi.stubEnv('DOKPLOY_ENDPOINT', undefined);
		cwd = process.cwd();
		process.chdir(root);
		dokploy = emptyDokploy(STAGE);
		serveDokploy(server, () => dokploy);
		out = [];
		for (const level of ['log', 'warn', 'error'] as const) {
			vi.spyOn(console, level).mockImplementation((...a) => {
				out.push(
					`${level === 'log' ? '' : `${level.toUpperCase()} `}${a.join(' ')}`,
				);
			});
		}
		vi.mocked(run).mockReset();
		vi.mocked(run).mockResolvedValue();
		vi.mocked(runOutput).mockReset();
		vi.mocked(runOutput).mockImplementation(async (_, args) => {
			const ref = args.at(-1)!;
			const repository = ref.replace(/:[\w][\w.-]*$/, '');
			return JSON.stringify([`${repository}@sha256:${'0'.repeat(64)}`]);
		});
		await storeDokployCredentials('token', ENDPOINT);
		writeShopWorkspace(root, STAGE);
	});

	afterEach(() => {
		process.chdir(cwd);
		server.resetHandlers();
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	it('prints what it always printed for a first deploy', async () => {
		await deployCommand({ provider: 'dokploy', stage: STAGE, tag: 'v1' });

		expect(printed()).toMatchSnapshot();
	});
});
