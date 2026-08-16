import { beforeEach, describe, expect, it } from 'vitest';
import { UnregisteredStorageScheme } from '../errors';
import {
	createStorageClient,
	registeredStorageSchemes,
	registerStorageDriver,
	type StorageDriver,
} from '../registry';
import { s3Driver } from '../s3Driver';

const fakeGcs: StorageDriver = {
	scheme: 'gs:',
	create: () => ({ provider: 'gcs' }) as never,
};

describe('storage driver registry', () => {
	beforeEach(() => {
		registerStorageDriver(s3Driver);
	});

	it('builds a client for a registered scheme', () => {
		const client = createStorageClient('s3://uploads?region=eu-west-1');
		expect(client).toBeDefined();
	});

	it('routes by scheme, so two providers coexist', () => {
		registerStorageDriver(fakeGcs);
		expect(createStorageClient('gs://uploads')).toEqual({ provider: 'gcs' });
		expect(registeredStorageSchemes()).toContain('s3:');
	});

	it('registering the same scheme twice replaces rather than duplicates', () => {
		registerStorageDriver(s3Driver);
		registerStorageDriver(s3Driver);
		expect(registeredStorageSchemes().filter((s) => s === 's3:')).toHaveLength(
			1,
		);
	});

	it('reports what is registered when a scheme has no driver', () => {
		expect.assertions(3);
		try {
			createStorageClient('azure://uploads');
		} catch (error) {
			const e = error as UnregisteredStorageScheme;
			expect(e).toBeInstanceOf(UnregisteredStorageScheme);
			expect(e.scheme).toBe('azure:');
			// what *is* available is the actionable half of this failure
			expect(e.registered).toContain('s3:');
		}
	});

	it('treats a string with no scheme as unregistered rather than crashing', () => {
		expect(() => createStorageClient('uploads')).toThrow(
			UnregisteredStorageScheme,
		);
	});
});
