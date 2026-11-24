import { describe, expect, it } from 'vitest';
import type { ResourceRecord } from '../../../deploy/StateStore';
import type { ProvisionState, StateEntry } from '../../types';
import {
	defaultGoogleProject,
	GoogleProjectChanged,
	googleProject,
	googleProjectKey,
	holdGoogleProject,
} from '../project';
import { GoogleIdInvalid } from '../resources';

/** A stage's provisioning record, held in memory as the journal holds it. */
function memoryState(): ProvisionState & {
	records: Map<string, ResourceRecord>;
} {
	const records = new Map<string, ResourceRecord>();
	const put = (entry: StateEntry, status: 'pending' | 'ready', id?: string) =>
		records.set(entry.key, {
			key: entry.key,
			type: entry.type,
			status,
			...(id ? { id } : {}),
			updatedAt: new Date().toISOString(),
		} as ResourceRecord);
	return {
		records,
		record: (key) => records.get(key),
		pending: async (entry) => {
			put(entry, 'pending');
		},
		ready: async (entry, id) => {
			put(entry, 'ready', id);
		},
	};
}

describe('the project a Google provider uses', () => {
	it('is --project, then the stage config, then <workspace>-<stage>', () => {
		const base = { workspace: 'Acme Shop', stage: 'prod' };

		expect([
			googleProject({ ...base, flag: 'acme-flag', configured: 'acme-config' }),
			googleProject({ ...base, configured: 'acme-config' }),
			googleProject(base),
		]).toEqual(['acme-flag', 'acme-config', 'acme-shop-prod']);
	});

	it('is an id Google accepts, cut to 30', () => {
		expect(
			defaultGoogleProject('a-very-long-workspace-name-indeed', 'staging'),
		).toBe('a-very-long-workspace-staging');
	});

	it('refuses an id Google would', () => {
		expect(() =>
			googleProject({ workspace: 'acme', stage: 'prod', flag: 'Bad_Id' }),
		).toThrow(GoogleIdInvalid);
	});
});

describe("the stage's record of its project", () => {
	const input = { stage: 'prod', kind: 'objects' as const };

	it('is written on the first run', async () => {
		const state = memoryState();

		await holdGoogleProject(state, { ...input, project: 'acme-prod' });

		expect(state.records.get(googleProjectKey('objects'))).toMatchObject({
			type: 'google-project',
			status: 'ready',
			id: 'acme-prod',
		});
	});

	it('stops a later run that resolves another project', async () => {
		const state = memoryState();
		await holdGoogleProject(state, { ...input, project: 'acme-prod' });

		const moved = holdGoogleProject(state, { ...input, project: 'acme-other' });

		await expect(moved).rejects.toBeInstanceOf(GoogleProjectChanged);
		await expect(moved).rejects.toMatchObject({
			recorded: 'acme-prod',
			requested: 'acme-other',
		});
	});

	it('writes nothing on a dry run', async () => {
		const state = memoryState();

		await holdGoogleProject(state, {
			...input,
			project: 'acme-prod',
			dryRun: true,
		});

		expect(state.records.size).toBe(0);
	});
});
