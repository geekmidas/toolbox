import { describe, expect, it } from 'vitest';
import {
	cacheBackendFor,
	eventsBackendFor,
	providerOf,
	storageBackendFor,
} from '../backends';

/**
 * Which backend a declared construct resolves to — decided by the deploy
 * target, and by nothing a config file says.
 *
 * A flat answer cannot be right for both a Lambda and a box running its own
 * Postgres, so every one of these is a function of the target, and these are
 * the cases where the two families disagree.
 */
describe('providerOf', () => {
	it('puts Dokploy and a bare server in the family that runs its own containers', () => {
		expect(providerOf({ deploy: { default: 'dokploy' } })).toBe('server');
		expect(providerOf({ deploy: { default: 'server' } })).toBe('server');
	});

	it('puts everything else — and no deploy target at all — on AWS', () => {
		// An SST deploy names no `deploy.default`, which is why the absence
		// is what selects `aws`.
		expect(providerOf({})).toBe('aws');
		expect(providerOf({ deploy: { default: 'vercel' } })).toBe('aws');
	});
});

describe('by target', () => {
	it('puts a cache in the database on a target that runs its own', () => {
		// The database is already there, with a pool open to it.
		expect(cacheBackendFor('server')).toBe('db');
	});

	it('puts a cache behind HTTP on AWS', () => {
		// Reachable from a Lambda with no VPC and no connection pool.
		expect(cacheBackendFor('aws')).toBe('upstash');
	});

	it('puts a bucket on the box, or in S3, by the same rule', () => {
		expect(storageBackendFor('server')).toBe('minio');
		expect(storageBackendFor('aws')).toBe('s3');
	});

	it('carries events on the broker the target has', () => {
		// A server keeps its queues in the Postgres it already runs; AWS
		// deploys them to SNS and SQS, and the emulator stands in locally.
		expect(eventsBackendFor('server')).toBe('pgboss');
		expect(eventsBackendFor('aws')).toBe('sns');
	});
});
