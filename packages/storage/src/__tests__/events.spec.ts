import { describe, expect, it } from 'vitest';
import {
	matchesObjectFilter,
	ObjectNotificationMalformed,
	toObjectEvents,
} from '../events';

/** One S3 record, as a notification carries it. */
function record(eventName: string, object: Record<string, unknown>) {
	return {
		eventVersion: '2.1',
		eventSource: 'aws:s3',
		awsRegion: 'eu-west-1',
		eventTime: '2026-10-17T09:00:00.000Z',
		eventName,
		s3: { bucket: { name: 'acme-uploads' }, object },
	};
}

describe('toObjectEvents', () => {
	it('reads a write from S3, with its size, entity tag and version', () => {
		const body = {
			Records: [
				record('ObjectCreated:Put', {
					key: 'avatars/me.png',
					size: 1024,
					eTag: '"0123abcd"',
					versionId: 'v1',
				}),
			],
		};

		expect(toObjectEvents(body)).toEqual([
			{
				type: 'object.created',
				payload: {
					bucket: 'acme-uploads',
					key: 'avatars/me.png',
					size: 1024,
					etag: '0123abcd',
					versionId: 'v1',
				},
			},
		]);
	});

	it("reads MinIO's event names, which carry an s3: prefix", () => {
		const body = {
			EventName: 's3:ObjectRemoved:Delete',
			Key: 'acme-uploads/avatars/me.png',
			Records: [record('s3:ObjectRemoved:Delete', { key: 'avatars/me.png' })],
		};

		expect(toObjectEvents(body)).toEqual([
			{
				type: 'object.deleted',
				payload: { bucket: 'acme-uploads', key: 'avatars/me.png' },
			},
		]);
	});

	it('decodes a form-encoded key: + is a space, %2B a plus', () => {
		const body = {
			Records: [
				record('ObjectCreated:Put', { key: 'my+photo%2B1%C3%A9.png', size: 1 }),
			],
		};

		expect(toObjectEvents(body)[0]?.payload.key).toBe('my photo+1é.png');
	});

	it('reads the JSON string SNS carries the body in', () => {
		const body = JSON.stringify({
			Records: [record('ObjectCreated:Copy', { key: 'a.txt', size: 3 })],
		});

		expect(toObjectEvents(body).map((m) => m.type)).toEqual(['object.created']);
	});

	it('reads every record in one notification', () => {
		const body = {
			Records: [
				record('ObjectCreated:Put', { key: 'a', size: 1 }),
				record('ObjectRemoved:DeleteMarkerCreated', { key: 'b' }),
			],
		};

		expect(toObjectEvents(body).map((m) => [m.type, m.payload.key])).toEqual([
			['object.created', 'a'],
			['object.deleted', 'b'],
		]);
	});

	it('reads the test event S3 sends on configuration as none', () => {
		expect(
			toObjectEvents({
				Service: 'Amazon S3',
				Event: 's3:TestEvent',
				Bucket: 'acme-uploads',
			}),
		).toEqual([]);
	});

	it('skips a record that is neither a write nor a delete', () => {
		const body = {
			Records: [
				record('ObjectRestore:Completed', { key: 'a' }),
				record('LifecycleTransition', { key: 'b' }),
			],
		};

		expect(toObjectEvents(body)).toEqual([]);
	});

	it('refuses a body that is not a notification', () => {
		expect(() => toObjectEvents('not json')).toThrow(
			ObjectNotificationMalformed,
		);
		expect(() => toObjectEvents({ type: 'user.created' })).toThrow(
			/no Records array/,
		);
		expect(() =>
			toObjectEvents({ Records: [{ eventName: 'ObjectCreated:Put' }] }),
		).toThrow(/no bucket or no object key/);
	});
});

describe('matchesObjectFilter', () => {
	it('keeps a key under the prefix that ends in the suffix', () => {
		const filter = { prefix: 'avatars/', suffix: '.png' };

		expect(matchesObjectFilter({ key: 'avatars/me.png' }, filter)).toBe(true);
		expect(matchesObjectFilter({ key: 'avatars/me.jpg' }, filter)).toBe(false);
		expect(matchesObjectFilter({ key: 'other/me.png' }, filter)).toBe(false);
	});

	it('keeps every key with no filter', () => {
		expect(matchesObjectFilter({ key: 'anything' })).toBe(true);
		expect(matchesObjectFilter({ key: 'anything' }, {})).toBe(true);
	});
});
