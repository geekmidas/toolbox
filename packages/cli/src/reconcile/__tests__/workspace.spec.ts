import { describe, expect, it } from 'vitest';
import type {
	NormalizedWorkspace,
	ServicesConfig,
} from '../../workspace/types';
import { extraContainers, imagePins } from '../workspace';

/** A workspace that declares nothing but the services under test. */
function workspaceWith(services: ServicesConfig): NormalizedWorkspace {
	return {
		name: 'test',
		root: '/tmp/test',
		apps: {},
		services,
		deploy: { default: 'dokploy' },
		shared: { packages: [] },
		secrets: {},
	};
}

describe('extraContainers', () => {
	it('starts Redis for a cache that only says it wants one', () => {
		expect(extraContainers(workspaceWith({ cache: true }))).toEqual(['redis']);
	});

	it('starts nothing for a service turned off or left out', () => {
		expect(extraContainers(workspaceWith({ cache: false }))).toEqual([]);
		expect(extraContainers(workspaceWith({}))).toEqual([]);
	});

	it.each([
		'db',
		'upstash',
		'elasticache',
	] as const)('leaves the container to the plan when the cache names a backend (%s)', (backend) => {
		// A backend name says *where the cache lives*, which the plan already
		// answers — `db` implies no container at all, `upstash` implies the
		// HTTP proxy rather than a bare Redis. Reading it as a request for one
		// is how `cache: 'db'` started a Redis nothing connected to.
		expect(extraContainers(workspaceWith({ cache: backend }))).toEqual([]);
	});

	it('ignores services whose container a construct already implies', () => {
		// A database, a bucket and a mailbox are declared, not configured — so
		// naming them here is a no-op rather than a second opinion.
		expect(
			extraContainers(workspaceWith({ db: true, storage: true, mail: 'ses' })),
		).toEqual([]);
	});

	it('still accepts an image pin, which is not a backend name', () => {
		expect(extraContainers(workspaceWith({ cache: { version: '7' } }))).toEqual(
			['redis'],
		);
	});
});

describe('imagePins', () => {
	it('reads a version pin as an image tag on its container', () => {
		expect(imagePins(workspaceWith({ cache: { version: '7' } }))).toEqual({
			redis: 'redis:7',
		});
	});

	it('takes a backend name as no pin at all', () => {
		expect(imagePins(workspaceWith({ cache: 'db' }))).toEqual({});
	});
});
