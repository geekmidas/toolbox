import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	APP_TAG_ENV,
	appTag,
	assignAppPorts,
	holderOf,
	type PortHolder,
	savedAppPorts,
	withAppPorts,
} from '../appPorts';

const workspaceAt = (root: string) =>
	({
		name: 'shop',
		root,
		apps: {
			api: { type: 'backend', path: 'apps/api', port: 3000 },
			auth: { type: 'backend', path: 'apps/auth', port: 3001 },
			web: { type: 'web', path: 'apps/web', port: 3002 },
		},
	}) as unknown as NormalizedWorkspace;

/** A machine where these ports are held, by these holders. */
const machine = (held: Record<number, PortHolder | undefined>) => ({
	free: async (port: number) => !(port in held),
	holder: (port: number) => held[port],
});

describe('assignAppPorts', () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'gkm-app-ports-'));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('keeps each app on its usual port when nothing holds it', async () => {
		const { ports, moved, running } = await assignAppPorts(
			workspaceAt(root),
			['api', 'auth', 'web'],
			machine({}),
		);

		expect(ports).toEqual({ api: 3000, auth: 3001, web: 3002 });
		expect(moved).toEqual([]);
		expect(running).toEqual([]);
	});

	it('moves off a port another project holds, past its siblings, and says from what', async () => {
		// Another project's Next.js dev server, on the port every project
		// defaults to — it carries no tag of ours.
		const other = { pid: 81245, command: 'next-server' };

		const { ports, moved } = await assignAppPorts(
			workspaceAt(root),
			['api', 'auth', 'web'],
			machine({ 3000: other }),
		);

		// Not onto 3001 or 3002: those are auth's and web's.
		expect(ports).toEqual({ api: 3003, auth: 3001, web: 3002 });
		expect(moved).toEqual([
			{ app: 'api', from: 3000, to: 3003, holder: other },
		]);
	});

	it('treats another workspace’s tagged process as not ours', async () => {
		const elsewhere = {
			pid: 7,
			tag: appTag('/somewhere/else', 'api'),
		};

		const { moved, running } = await assignAppPorts(
			workspaceAt(root),
			['api'],
			machine({ 3000: elsewhere }),
		);

		expect(running).toEqual([]);
		expect(moved).toHaveLength(1);
	});

	it('refuses — rather than moves — when the holder is this same app', async () => {
		// Left by a previous `gkm dev`: moving would start a second copy.
		const leftover = { pid: 2763, tag: appTag(root, 'api') };

		const { ports, running } = await assignAppPorts(
			workspaceAt(root),
			['api'],
			machine({ 3000: leftover }),
		);

		expect(running).toEqual([{ app: 'api', port: 3000, holder: leftover }]);
		expect(ports.api).toBe(3000);
	});

	it('keeps a move, so the app stays put once the other project stops', async () => {
		await assignAppPorts(
			workspaceAt(root),
			['api'],
			machine({ 3000: { pid: 1 } }),
		);

		const { ports, moved } = await assignAppPorts(
			workspaceAt(root),
			['api'],
			machine({}),
		);

		expect(ports.api).toBe(3001);
		expect(moved).toEqual([]);
		expect((await savedAppPorts(root)).api).toBe(3001);
	});

	it('hands every reader the assigned ports', () => {
		const workspace = withAppPorts(workspaceAt(root), { api: 3004 });

		expect(workspace.apps.api?.port).toBe(3004);
		expect(workspace.apps.auth?.port).toBe(3001);
	});
});

/** Whether `lsof` is here to ask — the tag is read the way a person would. */
const hasLsof = (() => {
	try {
		execFileSync('lsof', ['-v'], { stdio: 'ignore' });
		return true;
	} catch (error) {
		// `lsof -v` exits non-zero on some builds; only a missing binary counts.
		return (error as NodeJS.ErrnoException).code !== 'ENOENT';
	}
})();

describe.runIf(hasLsof)('holderOf, against a real process', () => {
	let child: ChildProcess | undefined;

	afterEach(() => {
		// The whole group: the parent, and the forked child that listens.
		if (child?.pid) {
			try {
				process.kill(-child.pid, 'SIGKILL');
			} catch {}
		}
		child = undefined;
	});

	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'gkm-holder-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	/** A tagged parent whose forked child is what listens, as `next dev` does. */
	async function listenTagged(tag: string): Promise<number> {
		const parent = join(dir, 'parent.mjs');
		const server = join(dir, 'server.mjs');
		await writeFile(
			server,
			"import { createServer } from 'node:http';\n" +
				'const s = createServer().listen(0, () => process.send(s.address().port));\n',
		);
		await writeFile(
			parent,
			"import { fork } from 'node:child_process';\n" +
				`fork(${JSON.stringify(server)}).on('message', (port) => process.send(port));\n`,
		);
		child = spawn(process.execPath, [parent], {
			env: { ...process.env, [APP_TAG_ENV]: tag },
			stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
			detached: true,
		});
		return new Promise((resolve) => child!.once('message', resolve));
	}

	it('finds what holds a port, and reads the tag it inherited', async () => {
		const tag = appTag('/work/shop', 'api');
		const port = await listenTagged(tag);

		const holder = holderOf(port);

		expect(holder?.pid).toBeGreaterThan(0);
		expect(holder?.tag).toBe(tag);
	});

	it('finds nothing on a free port', () => {
		expect(holderOf(1)).toBeUndefined();
	});
});
