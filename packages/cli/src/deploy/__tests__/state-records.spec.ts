/**
 * The parts of a stage's deploy state that outlive a deploy: the DNS records
 * it created (so undeploy can remove exactly those) and its backup schedule.
 */

import { describe, expect, it } from 'vitest';
import {
	clearDnsRecords,
	createEmptyState,
	getAllDnsRecords,
	getBackupDestinationId,
	getBackupState,
	getDnsRecord,
	getPostgresBackupId,
	removeDnsRecord,
	setBackupState,
	setDnsRecord,
	setPostgresBackupId,
} from '../state';

const fresh = () => createEmptyState('production', 'proj', 'env');

const record = {
	domain: 'shop.com',
	name: 'api',
	type: 'A' as const,
	value: '1.2.3.4',
	ttl: 300,
};

describe('DNS records in state', () => {
	it('stores a record by name and type, stamped with when', () => {
		const state = fresh();

		setDnsRecord(state, record);

		expect(getDnsRecord(state, 'api', 'A')).toEqual({
			...record,
			createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
		});
		expect(getDnsRecord(state, 'api', 'AAAA')).toBeUndefined();
		expect(getAllDnsRecords(state)).toHaveLength(1);
	});

	it('answers nothing for a stage that has no state yet', () => {
		expect(getDnsRecord(null, 'api', 'A')).toBeUndefined();
		expect(getAllDnsRecords(null)).toEqual([]);
	});

	it('removes one record, and tolerates a state with none', () => {
		const state = fresh();
		setDnsRecord(state, record);
		setDnsRecord(state, { ...record, name: '@' });

		removeDnsRecord(state, 'api', 'A');

		expect(getAllDnsRecords(state).map((r) => r.name)).toEqual(['@']);

		const empty = fresh();
		removeDnsRecord(empty, 'api', 'A');
		expect(getAllDnsRecords(empty)).toEqual([]);
	});

	it('clears the records and what was verified about them', () => {
		const state = fresh();
		setDnsRecord(state, record);
		state.dnsVerified = {
			'api.shop.com': { serverIp: '1.2.3.4', verifiedAt: 'then' },
		};

		clearDnsRecords(state);

		expect(state.dnsRecords).toEqual({});
		expect(state.dnsVerified).toEqual({});
	});
});

describe('backup state', () => {
	it('is absent until a destination is provisioned', () => {
		const state = fresh();

		expect(getBackupState(state)).toBeUndefined();
		expect(getBackupDestinationId(state)).toBeUndefined();
		expect(getPostgresBackupId(null)).toBeUndefined();
	});

	it('records the destination, then the schedule made against it', () => {
		const state = fresh();
		const backups = {
			bucketName: 'shop-backups',
			bucketArn: 'arn:aws:s3:::shop-backups',
			iamUserName: 'shop-backup',
			iamAccessKeyId: 'AKIA',
			iamSecretAccessKey: 'secret',
			destinationId: 'dst1',
			region: 'eu-west-1',
			createdAt: 'now',
		};

		setBackupState(state, backups as never);
		setPostgresBackupId(state, 'b1');

		expect(getBackupDestinationId(state)).toBe('dst1');
		expect(getPostgresBackupId(state)).toBe('b1');
		expect(getBackupState(state)).toMatchObject({ postgresBackupId: 'b1' });
	});

	it('does not invent a destination to hang a schedule on', () => {
		const state = fresh();

		setPostgresBackupId(state, 'b1');

		expect(getBackupState(state)).toBeUndefined();
	});
});
