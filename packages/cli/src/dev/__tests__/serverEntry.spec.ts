import { spawn } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { generateServerEntryContent } from '../index';

/**
 * The dev server entry exits with the `gkm dev` that started it.
 *
 * Dev stops its server on a signal, but a dev process killed outright never
 * gets to — and the server kept its port, so the next `gkm dev` found the port
 * taken. Real processes, because what is under test is a process outliving
 * another.
 */

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

async function until(check: () => boolean, timeout = 10_000) {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > timeout) return false;
		await new Promise((r) => setTimeout(r, 100));
	}
	return true;
}

describe('the dev server entry', { timeout: 20_000 }, () => {
	let dir: string;
	const started: number[] = [];

	beforeEach(async () => {
		dir = realpathSync(await createTempDir('server-entry-'));
		writeFileSync(
			join(dir, 'package.json'),
			JSON.stringify({ type: 'module' }),
		);
		// An app that never stops serving, like a real one.
		writeFileSync(
			join(dir, 'app.ts'),
			`export async function createApp() {
  return {
    app: {},
    start: () => {
      setInterval(() => {}, 1000);
      return new Promise(() => {});
    },
  };
}
`,
		);
		writeFileSync(
			join(dir, 'server.ts'),
			generateServerEntryContent({ appImportPath: './app.ts' }),
		);
	});

	afterEach(async () => {
		for (const pid of started.splice(0)) {
			try {
				process.kill(pid, 'SIGKILL');
			} catch {}
		}
		await cleanupDir(dir);
	});

	/**
	 * A stand-in for `gkm dev`: starts the entry the way dev does and reports
	 * the server's pid. Resolves with both pids once the server is up.
	 */
	async function startUnderParent(passParentPid: boolean) {
		const parent = spawn(
			process.execPath,
			[
				'-e',
				`const { spawn } = require('node:child_process');
const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: ${JSON.stringify(dir)},
  stdio: 'ignore',
  env: { ...process.env${passParentPid ? ', GKM_DEV_PID: String(process.pid)' : ''} },
});
console.log(server.pid);
setInterval(() => {}, 1000);`,
			],
			{ cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] },
		);
		const serverPid = await new Promise<number>((resolve) =>
			parent.stdout.once('data', (chunk) => resolve(Number(String(chunk)))),
		);
		started.push(parent.pid!, serverPid);

		// Up, and past the entry's imports.
		await new Promise((r) => setTimeout(r, 2_000));
		expect(alive(serverPid)).toBe(true);

		return { parent: parent.pid!, server: serverPid };
	}

	it('exits when the gkm dev that started it is killed outright', async () => {
		const { parent, server } = await startUnderParent(true);

		process.kill(parent, 'SIGKILL');

		expect(await until(() => !alive(server))).toBe(true);
	});

	it('is what makes it exit — without it the server outlives dev', async () => {
		const { parent, server } = await startUnderParent(false);

		process.kill(parent, 'SIGKILL');

		expect(await until(() => !alive(server), 3_000)).toBe(false);
	});
});
