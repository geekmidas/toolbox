import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { recordedPushSubscriptions } from '../../deploy/snsSubscriptions';
import {
	bucketWatchers,
	eventsDeadLetterName,
	eventsTopicName,
	mergedNotifications,
} from '../s3/events';

const manifest = {
	Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
	Exports: { kind: 'objects', id: 'Exports', provides: ['EXPORTS_URL'] },
} as unknown as ConstructManifest;

const TOPIC = 'arn:aws:sns:eu-west-1:123456789012:acme-uploads-events';

describe('bucketWatchers', () => {
	it('names each subscriber watching a bucket, by worker and export', () => {
		const watched = bucketWatchers(
			manifest,
			{ Jobs: ['Uploads#events'] },
			{
				Jobs: [
					{
						name: 'onAvatar',
						connectionKey: 'UPLOADS_EVENTS_CONNECTION_STRING',
					},
					{
						name: 'onAlert',
						connectionKey: 'ALERTS_PUBLISHER_CONNECTION_STRING',
					},
				],
				Media: [
					{
						name: 'onPhoto',
						connectionKey: 'UPLOADS_EVENTS_CONNECTION_STRING',
					},
				],
			},
		);

		expect([...watched.keys()]).toEqual(['Uploads']);
		expect(watched.get('Uploads')).toEqual([
			{ worker: 'Jobs', name: 'onAvatar' },
			{ worker: 'Media', name: 'onPhoto' },
		]);
	});

	it('counts a bucket watched by an edge alone, with nobody to subscribe', () => {
		const watched = bucketWatchers(manifest, { Jobs: ['Exports#events'] });

		expect(watched.get('Exports')).toEqual([]);
		expect(watched.has('Uploads')).toBe(false);
	});

	it('watches nothing when no subscriber does', () => {
		expect(bucketWatchers(manifest, { Jobs: ['Uploads'] }).size).toBe(0);
	});
});

describe('mergedNotifications', () => {
	const ours = {
		Id: 'gkm-Uploads',
		TopicArn: TOPIC,
		Events: ['s3:ObjectCreated:*', 's3:ObjectRemoved:*'],
	};

	it('adds its entry beside every other, keeping theirs as they were', () => {
		const theirs = {
			Id: 'audit',
			TopicArn: 'arn:aws:sns:eu-west-1:123456789012:audit',
			Events: ['s3:ObjectRestore:*'],
			Filter: { Key: { FilterRules: [{ Name: 'prefix', Value: 'a/' }] } },
		};
		const queue = { Id: 'q', QueueArn: 'arn:aws:sqs:x', Events: ['s3:*'] };

		const { config, changed } = mergedNotifications(
			{ TopicConfigurations: [theirs], QueueConfigurations: [queue] },
			'Uploads',
			TOPIC,
		);

		expect(changed).toBe(true);
		expect(config.TopicConfigurations).toEqual([theirs, ours]);
		expect(config.QueueConfigurations).toEqual([queue]);
	});

	it('is unchanged when its entry is already there, in any order', () => {
		const { changed } = mergedNotifications(
			{
				TopicConfigurations: [
					{ ...ours, Events: ['s3:ObjectRemoved:*', 's3:ObjectCreated:*'] },
				],
			},
			'Uploads',
			TOPIC,
		);

		expect(changed).toBe(false);
	});

	it('puts back an entry that drifted', () => {
		const { config, changed } = mergedNotifications(
			{ TopicConfigurations: [{ ...ours, Events: ['s3:ObjectCreated:Put'] }] },
			'Uploads',
			TOPIC,
		);

		expect(changed).toBe(true);
		expect(config.TopicConfigurations).toEqual([ours]);
	});
});

describe('names', () => {
	it('names the topic and queue after the bucket, without its dots', () => {
		expect(eventsTopicName('acme.uploads')).toBe('acme-uploads-events');
		expect(eventsDeadLetterName('acme.uploads')).toBe(
			'acme-uploads-events-dlq',
		);
	});
});

describe('recordedPushSubscriptions', () => {
	it('reads each recorded subscription back by worker and export', () => {
		const at = new Date().toISOString();
		expect(
			recordedPushSubscriptions({
				'sns-subscription:Jobs/onAvatar': {
					key: 'sns-subscription:Jobs/onAvatar',
					type: 'sns-subscription',
					status: 'ready',
					id: `${TOPIC}:1`,
					updatedAt: at,
				},
				'sns-topic:Uploads': {
					key: 'sns-topic:Uploads',
					type: 'sns-topic',
					status: 'ready',
					id: TOPIC,
					updatedAt: at,
				},
			}),
		).toEqual({ Jobs: { onAvatar: `${TOPIC}:1` } });
	});
});
