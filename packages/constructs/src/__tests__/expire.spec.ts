import { describe, expect, it } from 'vitest';
import { BucketOptionOnOrigin, FileServer } from '../file-server';
import {
	ExpiryDaysInvalid,
	ExpiryPrefixInvalid,
	ObjectStorage,
} from '../object-storage';

describe('a bucket that expires a prefix', () => {
	it('declares each prefix and the days it is kept', () => {
		const bucket = new ObjectStorage('Private', {
			expire: { 'quotes/': { days: 30 }, 'tmp/': { days: 1 } },
		});

		expect(bucket.declare()).toEqual([
			{
				kind: 'objects',
				id: 'Private',
				provides: ['PRIVATE_URL'],
				expire: { 'quotes/': 30, 'tmp/': 1 },
			},
		]);
	});

	it('declares nothing for an empty expiry', () => {
		expect(new ObjectStorage('Private', { expire: {} }).declare()).toEqual([
			{ kind: 'objects', id: 'Private', provides: ['PRIVATE_URL'] },
		]);
	});

	it('puts it on the bucket a file server vends, not on the surface', () => {
		const files = new FileServer('Uploads', {
			open: ['brand/**'],
			expire: { 'previews/': { days: 7 } },
		});

		expect(files.declare()).toEqual([
			{
				kind: 'objects',
				id: 'Uploads',
				provides: ['UPLOADS_URL'],
				expire: { 'previews/': 7 },
			},
			{
				kind: 'file-server',
				id: 'UploadsServer',
				of: 'Uploads',
				open: ['brand/**'],
				provides: ['UPLOADS_SERVER_URL'],
			},
		]);
	});

	it('refuses it on a file server fronting a bucket declared elsewhere', () => {
		const bucket = new ObjectStorage('Assets');
		const make = () =>
			new FileServer('Files', {
				origin: bucket,
				expire: { 'tmp/': { days: 1 } },
			});

		expect(make).toThrow(BucketOptionOnOrigin);
		expect(make).toThrow(
			/'expire' belongs on the construct that declares 'Assets'/,
		);
	});

	it.each([
		['', 'is empty'],
		['/quotes/', "starts with '/'"],
		['quotes/*', 'is a pattern'],
	])('refuses the prefix %j, which %s', (prefix, reason) => {
		const make = () =>
			new ObjectStorage('Private', { expire: { [prefix]: { days: 30 } } });

		expect(make).toThrow(ExpiryPrefixInvalid);
		expect(make).toThrow(reason);
	});

	it.each([0, -1, 1.5, Number.NaN])('refuses %s days', (days) => {
		const make = () =>
			new ObjectStorage('Private', { expire: { 'quotes/': { days } } });

		expect(make).toThrow(ExpiryDaysInvalid);
	});
});
