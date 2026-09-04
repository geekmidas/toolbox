import { describe, expect, it } from 'vitest';
import {
	backendsFor,
	cacheBackendOf,
	emailBackendOf,
	imagePinOf,
	providerOf,
	storageBackendOf,
	unknownBackend,
} from '../backends';

/**
 * Which backend a workspace gets, and where the answer comes from when it
 * says nothing.
 *
 * The interesting half is the second one. A flat default cannot be right for
 * both a Lambda and a box running its own Postgres, so "what happens when
 * nobody said" is a function of the deploy target — and these are the cases
 * where the two families disagree.
 */
describe('a named backend', () => {
	it('is taken as written, whatever the target', () => {
		// Naming one is the end of the question. A target-aware default is only
		// what happens in the absence of an answer, never an override of one.
		expect(cacheBackendOf('elasticache', 'server')).toBe('elasticache');
		expect(storageBackendOf('s3', 'server')).toBe('s3');
		expect(storageBackendOf('minio', 'aws')).toBe('minio');
	});

	it('is not an image pin, and an image pin is not one', () => {
		// One key answers two questions — what runs locally, what backs it
		// deployed — so every reader has to know which it was handed.
		expect(imagePinOf('s3')).toBeUndefined();
		expect(imagePinOf({ version: '7-alpine' })).toEqual({
			version: '7-alpine',
		});
	});
});

describe('the default when nobody said', () => {
	it('puts a cache in the database on a target that runs its own', () => {
		// The database is already there and already has a pool open to it.
		// Anything else is a second service to run for a table.
		expect(cacheBackendOf(undefined, 'server')).toBe('db');
	});

	it('puts a cache behind HTTP on AWS', () => {
		// Reachable from a Lambda with no VPC and no connection pool, which is
		// the whole reason it is the default there.
		expect(cacheBackendOf(undefined, 'aws')).toBe('upstash');
	});

	it('puts a bucket on the box, or in S3, by the same rule', () => {
		expect(storageBackendOf(undefined, 'server')).toBe('minio');
		expect(storageBackendOf(undefined, 'aws')).toBe('s3');
	});

	it('does not vary mail, because mail is a SaaS everywhere', () => {
		// There is no self-hosted preset to default a container deploy to —
		// Mailpit is a development inbox, not a sender — so a second entry would
		// only be `ses` written twice.
		expect(emailBackendOf(undefined)).toBe('ses');
	});

	it('applies to an image pin too: a container is not a backend', () => {
		// `cache: true` asks for a local container and says nothing about where
		// the cache lives deployed, so the target still decides that half.
		expect(cacheBackendOf(true, 'server')).toBe('db');
		expect(cacheBackendOf({ version: '7-alpine' }, 'aws')).toBe('upstash');
	});
});

describe('which family a target belongs to', () => {
	it('is one question: does it run containers the project controls', () => {
		expect(providerOf({ deploy: { default: 'dokploy' } })).toBe('server');
		expect(providerOf({ deploy: { default: 'server' } })).toBe('server');
	});

	it('answers "no" for a managed target, including one that is not AWS', () => {
		// Vercel and Cloudflare have no box to put MinIO on either, so they take
		// the managed defaults. Three targets, one answer.
		expect(providerOf({ deploy: { default: 'vercel' } })).toBe('aws');
		expect(providerOf({ deploy: { default: 'cloudflare' } })).toBe('aws');
	});

	it('reads no deploy block as AWS, because that one goes through SST', () => {
		expect(providerOf({})).toBe('aws');
	});
});

describe('a misspelled backend', () => {
	it('is reported rather than silently defaulted', () => {
		expect(unknownBackend('upstsh', 'cache')).toBe('upstsh');
		expect(unknownBackend('s4', 'storage')).toBe('s4');
		expect(unknownBackend('s3', 'storage')).toBeUndefined();
	});

	it('is not what a caller means by `cache: true`', () => {
		// An image pin is not a misspelled backend, so a project asking for a
		// container is not told it named one wrongly.
		expect(unknownBackend(true, 'cache')).toBeUndefined();
	});

	it('can be answered with what the key does accept', () => {
		expect(backendsFor('storage')).toEqual(['minio', 's3', 'r2']);
	});
});
