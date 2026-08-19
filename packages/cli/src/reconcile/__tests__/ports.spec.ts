import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { allocate, isPortFree, NoPortAvailable, startingPort } from '../ports';

/** Nothing is listening anywhere. */
const free = async () => true;

/** Everything in `busy` is taken by some other project's stack. */
const busyExcept = (busy: readonly number[]) => async (port: number) =>
	!busy.includes(port);

describe('startingPort', () => {
	it('is stable for a project name', () => {
		// A fresh clone has nothing persisted to read, so the first run has to
		// land where the last one did.
		expect(startingPort('toolbox')).toBe(startingPort('toolbox'));
	});

	it('separates two projects', () => {
		expect(startingPort('toolbox')).not.toBe(startingPort('other-project'));
	});

	it('stays clear of privileged and ephemeral ranges', () => {
		// Below 1024 needs root; 32768+ on Linux and 49152+ on macOS is what the
		// kernel hands to outgoing connections.
		for (const name of ['a', 'b', 'toolbox', 'a-much-longer-project-name']) {
			expect(startingPort(name)).toBeGreaterThanOrEqual(20000);
			expect(startingPort(name)).toBeLessThan(32000);
		}
	});
});

describe('allocate', () => {
	it('assigns a port to every container', async () => {
		const ports = await allocate('toolbox', ['postgres', 'minio'], {}, free);

		expect(Object.keys(ports).sort()).toEqual(['minio', 'postgres']);
	});

	it('never assigns one port twice', async () => {
		const ports = await allocate(
			'toolbox',
			['postgres', 'minio', 'mailpit'],
			{},
			free,
		);
		const assigned = Object.values(ports);

		expect(new Set(assigned).size).toBe(assigned.length);
	});

	it('keeps what was already assigned', async () => {
		// The whole point: adding a construct must not renumber its neighbours,
		// or every running container and saved connection string goes stale.
		const before = await allocate('toolbox', ['postgres'], {}, free);
		const after = await allocate(
			'toolbox',
			['postgres', 'minio'],
			before,
			free,
		);

		expect(after.postgres).toBe(before.postgres);
	});

	it('keeps a port for a container no longer planned', async () => {
		// So removing a construct and re-adding it later restores its port
		// rather than inventing a new one.
		const before = await allocate('toolbox', ['postgres', 'minio'], {}, free);
		const after = await allocate('toolbox', ['postgres'], before, free);

		expect(after.minio).toBe(before.minio);
	});

	it('does not depend on the order containers arrive in', async () => {
		const forwards = await allocate('toolbox', ['postgres', 'minio'], {}, free);
		const backwards = await allocate(
			'toolbox',
			['minio', 'postgres'],
			{},
			free,
		);

		expect(forwards).toEqual(backwards);
	});

	it('starts a project at its own block', async () => {
		const ports = await allocate('toolbox', ['postgres'], {}, free);

		expect(ports.postgres).toBe(startingPort('toolbox'));
	});

	it('steps over a port another project is already listening on', async () => {
		const base = startingPort('toolbox');
		const ports = await allocate(
			'toolbox',
			['postgres'],
			{},
			busyExcept([base]),
		);

		expect(ports.postgres).toBe(base + 1);
	});

	it('is convergent — reconciling twice changes nothing', async () => {
		const first = await allocate('toolbox', ['postgres', 'minio'], {}, free);
		const second = await allocate(
			'toolbox',
			['postgres', 'minio'],
			first,
			free,
		);

		expect(second).toEqual(first);
	});

	it('does not reprobe a port it already assigned', async () => {
		// On a converged reconcile our own container is what is listening, so
		// probing it would hand the project a new port every run.
		const first = await allocate('toolbox', ['postgres'], {}, free);
		const second = await allocate(
			'toolbox',
			['postgres'],
			first,
			busyExcept(Object.values(first)),
		);

		expect(second).toEqual(first);
	});

	it('reports an exhausted window rather than looping', async () => {
		await expect(
			allocate('toolbox', ['postgres'], {}, async () => false),
		).rejects.toThrow(NoPortAvailable);
	});

	it('states the rule and carries the value as a field', async () => {
		await expect(
			allocate('toolbox', ['postgres'], {}, async () => false),
		).rejects.toMatchObject({
			message: 'No free port is available in the local port range',
			from: startingPort('toolbox'),
		});
	});

	it('allocates nothing for no containers', async () => {
		expect(await allocate('toolbox', [], {}, free)).toEqual({});
	});
});

describe('isPortFree', () => {
	it('reports a free port as free', async () => {
		// Real bind, no mock — the probe's whole job is to ask the OS.
		expect(await isPortFree(0)).toBe(true);
	});

	it('reports a port something is listening on as taken', async () => {
		// Occupy one for real rather than assuming a privileged port is refused —
		// which it is not, everywhere this suite runs.
		const server = createServer();
		const port = await new Promise<number>((resolve) => {
			server.listen(0, '0.0.0.0', () => {
				const address = server.address();
				resolve(typeof address === 'object' && address ? address.port : 0);
			});
		});

		try {
			expect(await isPortFree(port)).toBe(false);
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});
});
