/**
 * Loading `gkm.config.ts` in a sandbox: in a child of its own, handed back as
 * JSON, with what the sandbox's isolation decides about live objects in it.
 */

import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ConfigLoadFailed,
	ConfigObjectNotSerializable,
	loadWorkspaceConfig,
} from '../config';
import { CommandTimedOut } from '../run';
import { LocalSandbox } from '../sandbox/local';
import type { Sandbox } from '../sandbox/sandbox';

/** A workspace config whose `extra` source is spliced into the object. */
const config = (extra = '', before = '') => `${before}
export default {
  name: 'shop',
  constructs: './constructs/**/*.ts',
  stages: { local: 'dev', deployed: ['production'] },
  ${extra}
};
`;

/**
 * A sandbox that isolates, standing in for a host's container: the same
 * child processes as `LocalSandbox`, and the promise that nothing but data
 * comes back.
 */
function isolating(root: string, log: string[] = []): Sandbox {
	const local = new LocalSandbox({ root });
	return {
		root: local.root,
		isolating: true,
		env: local.env,
		exec: (command, args, options) => {
			log.push(args.find((a) => /(config|discover)-worker/.test(a)) ?? command);
			return local.exec(command, args, options);
		},
	};
}

describe('loading the config in a sandbox', () => {
	let root: string;

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-config-sandbox-')));
		writeFileSync(join(root, 'package.json'), '{ "type": "module" }');
		mkdirSync(join(root, 'constructs'));
		writeFileSync(
			join(root, 'constructs', 'api.ts'),
			`import { RestApi } from '@geekmidas/constructs/rest-api';
export const api = new RestApi('Api', { path: 'apps/api', defaultAuthorizer: 'none' });
`,
		);
		mkdirSync(join(root, 'apps', 'api'), { recursive: true });
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		rmSync(root, { recursive: true, force: true });
	});

	it('hands back a plain config as data, apps derived in the sandbox too', async () => {
		writeFileSync(join(root, 'gkm.config.ts'), config());
		const ran: string[] = [];

		const loaded = await loadWorkspaceConfig(root, {
			sandbox: isolating(root, ran),
		});

		expect(loaded.workspace.name).toBe('shop');
		expect(Object.keys(loaded.workspace.apps)).toEqual(['api']);
		expect(loaded.workspace.apps.api?.path).toBe('apps/api');
		// Both steps that import the project's code ran there, not here.
		expect(
			ran.map((script) => script.match(/(config|discover)-worker/)?.[0]),
		).toEqual(['config-worker', 'discover-worker']);
	});

	it('sees the same workspace a load in this process does', async () => {
		writeFileSync(join(root, 'gkm.config.ts'), config());

		const sandboxed = await loadWorkspaceConfig(root, {
			sandbox: isolating(root),
		});
		const here = await loadWorkspaceConfig(root);

		expect(sandboxed.workspace).toEqual(here.workspace);
		expect(sandboxed.manifest).toEqual(here.manifest);
	});

	it('refuses a custom object under an isolating sandbox', async () => {
		writeFileSync(
			join(root, 'gkm.config.ts'),
			config(
				'state: { provider: new MemoryStore() },',
				`class MemoryStore {
  async read() { return null; }
  async write() {}
}`,
			),
		);

		const error = await loadWorkspaceConfig(root, {
			sandbox: isolating(root),
		}).catch((e: unknown) => e);

		expect(error).toBeInstanceOf(ConfigObjectNotSerializable);
		expect(error).toMatchObject({
			configPath: join(root, 'gkm.config.ts'),
			paths: ['state.provider'],
		});
	});

	it('keeps a trusted project’s live objects under the local sandbox', async () => {
		writeFileSync(
			join(root, 'gkm.config.ts'),
			config(
				'state: { provider: new MemoryStore() },',
				`class MemoryStore {
  async read() { return 'from-the-store'; }
  async write() {}
}`,
			),
		);

		const loaded = await loadWorkspaceConfig(root, {
			sandbox: new LocalSandbox({ root }),
		});

		const provider = loaded.workspace.state?.provider as {
			read(): Promise<string>;
		};
		expect(await provider.read()).toBe('from-the-store');
	});

	it('loads it without the deploy’s credentials in reach', async () => {
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'aws-secret');
		writeFileSync(
			join(root, 'gkm.config.ts'),
			config().replace(
				"name: 'shop'",
				"name: process.env.AWS_SECRET_ACCESS_KEY ?? 'none-seen'",
			),
		);

		const loaded = await loadWorkspaceConfig(root, {
			sandbox: isolating(root),
		});
		const here = await loadWorkspaceConfig(root);

		expect(loaded.workspace.name).toBe('none-seen');
		// The same file, read in this process, does see it.
		expect(here.workspace.name).toBe('aws-secret');
	});

	it('says why a config that throws could not be loaded', async () => {
		writeFileSync(
			join(root, 'gkm.config.ts'),
			config('', "throw new Error('half-written');"),
		);

		await expect(
			loadWorkspaceConfig(root, { sandbox: isolating(root) }),
		).rejects.toThrow(ConfigLoadFailed);
		await expect(
			loadWorkspaceConfig(root, { sandbox: isolating(root) }),
		).rejects.toThrow('half-written');
	});

	it('stops a config that never finishes loading', async () => {
		writeFileSync(
			join(root, 'gkm.config.ts'),
			config('', 'setInterval(() => {}, 1000); await new Promise(() => {});'),
		);

		await expect(
			loadWorkspaceConfig(root, { sandbox: isolating(root), timeoutMs: 2_000 }),
		).rejects.toBeInstanceOf(CommandTimedOut);
	});

	it('runs only inside the project the sandbox was given', async () => {
		writeFileSync(join(root, 'gkm.config.ts'), config());
		const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-other-')));
		try {
			await expect(
				loadWorkspaceConfig(root, { sandbox: isolating(elsewhere) }),
			).rejects.toMatchObject({ name: 'SandboxCwdEscape' });
		} finally {
			rmSync(elsewhere, { recursive: true, force: true });
		}
	});
});
