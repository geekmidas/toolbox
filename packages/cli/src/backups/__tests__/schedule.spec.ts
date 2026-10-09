import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { WorkspaceConfigSchema } from '../../workspace/schema';
import type { NormalizedWorkspace } from '../../workspace/types';
import {
	backupExpiries,
	backupsPrefix,
	runFolder,
	runTime,
	stageBackups,
} from '../config';
import { nextRun as runnerNextRun } from '../runner';
import {
	BackupCronInvalid,
	BackupIntervalInvalid,
	BackupRetentionInvalid,
	BackupsEntryInvalid,
	checkStageBackups,
	nextRun,
	parseCron,
} from '../schedule';

const WITH_DATABASE = {
	Database: { kind: 'database' },
	AuthDatabase: { kind: 'database' },
} as unknown as ConstructManifest;

function workspace(
	backups?: Record<string, unknown>,
	parts: { target?: string; state?: NormalizedWorkspace['state'] } = {},
): NormalizedWorkspace {
	return {
		name: 'shop',
		apps: {},
		deploy: {
			default: parts.target ?? 'compose',
			...(backups ? { backups } : {}),
		},
		stages: { local: 'dev', deployed: ['prod', 'staging'] },
		secrets: {},
		...(parts.state ? { state: parts.state } : {}),
	} as unknown as NormalizedWorkspace;
}

describe('a stage that names no backups', () => {
	it('is backed up every day at 02:00 UTC, kept 30 days, when compose deploys it and it runs Postgres', () => {
		const choice = stageBackups(workspace(), WITH_DATABASE, 'prod');

		expect(choice).toMatchObject({
			mode: 'on',
			source: 'default',
			backups: {
				schedule: { kind: 'every', seconds: 86_400, offset: 7_200 },
				keepDays: 30,
				maxGapSeconds: 86_400,
			},
		});
		if (choice.mode !== 'on') return expect.unreachable();
		expect(
			nextRun(choice.backups.schedule, new Date('2026-10-10T01:59:00Z')),
		).toEqual(new Date('2026-10-10T02:00:00Z'));
		expect(
			nextRun(choice.backups.schedule, new Date('2026-10-10T02:00:00Z')),
		).toEqual(new Date('2026-10-11T02:00:00Z'));
	});

	it('is not backed up on the local stage, without Postgres, or outside compose', () => {
		expect(stageBackups(workspace(), WITH_DATABASE, 'dev')).toEqual({
			mode: 'none',
			reason: 'local',
		});
		expect(stageBackups(workspace(), {}, 'prod')).toEqual({
			mode: 'none',
			reason: 'no-postgres',
		});
		expect(
			stageBackups(
				workspace(undefined, { target: 'dokploy' }),
				WITH_DATABASE,
				'prod',
			),
		).toEqual({ mode: 'none', reason: 'not-compose' });
	});

	it('never backs up the local stage, whatever it names', () => {
		expect(
			stageBackups(workspace({ dev: { every: '1h' } }), WITH_DATABASE, 'dev'),
		).toEqual({ mode: 'none', reason: 'local' });
	});
});

describe('deploy.backups.<stage>', () => {
	it('runs every interval, counted from 02:00 UTC', () => {
		const choice = stageBackups(
			workspace({ prod: { every: '6h', keep: '14d' } }),
			WITH_DATABASE,
			'prod',
		);
		if (choice.mode !== 'on') return expect.unreachable();
		expect(choice.source).toBe('config');
		expect(choice.backups.keepDays).toBe(14);
		expect(choice.backups.maxGapSeconds).toBe(21_600);

		const runs: string[] = [];
		let at = new Date('2026-10-10T00:00:00Z');
		for (let i = 0; i < 5; i++) {
			at = nextRun(choice.backups.schedule, at)!;
			runs.push(at.toISOString());
		}
		expect(runs).toEqual([
			'2026-10-10T02:00:00.000Z',
			'2026-10-10T08:00:00.000Z',
			'2026-10-10T14:00:00.000Z',
			'2026-10-10T20:00:00.000Z',
			'2026-10-11T02:00:00.000Z',
		]);
	});

	it('runs on a cron, in UTC, its longest gap what the health check counts', () => {
		const choice = stageBackups(
			workspace({ prod: { cron: '30 3 * * 1,4' } }),
			WITH_DATABASE,
			'prod',
		);
		if (choice.mode !== 'on') return expect.unreachable();
		expect(choice.backups.keepDays).toBe(30);
		// Thursday 03:30 to Monday 03:30.
		expect(choice.backups.maxGapSeconds).toBe(4 * 86_400);
		expect(
			nextRun(choice.backups.schedule, new Date('2026-10-09T12:00:00Z')),
		).toEqual(new Date('2026-10-12T03:30:00Z'));
	});

	it('is off with false, and deletes nothing — no expiry for it', () => {
		const ws = workspace({ prod: false });
		expect(stageBackups(ws, WITH_DATABASE, 'prod')).toEqual({
			mode: 'disabled',
		});
		expect(backupExpiries(ws, WITH_DATABASE).map((e) => e.id)).toEqual([
			'gkm-backups-staging',
		]);
	});

	it('refuses an interval shorter than an hour, or not an interval, by name', () => {
		expect(() => checkStageBackups('prod', { every: '30m' })).toThrow(
			BackupIntervalInvalid,
		);
		expect(() => checkStageBackups('prod', { every: 'daily' })).toThrow(
			BackupIntervalInvalid,
		);
		expect(checkStageBackups('prod', { every: '60m' })).toMatchObject({
			maxGapSeconds: 3600,
		});
	});

	it('refuses a cron that is not five fields, or runs more than hourly', () => {
		expect(() => checkStageBackups('prod', { cron: '0 2 * *' })).toThrow(
			BackupCronInvalid,
		);
		expect(() => checkStageBackups('prod', { cron: '*/15 * * * *' })).toThrow(
			BackupCronInvalid,
		);
		expect(() => checkStageBackups('prod', { cron: '0 25 * * *' })).toThrow(
			BackupCronInvalid,
		);
	});

	it('refuses a keep that is not days, and an entry of another shape', () => {
		expect(() => checkStageBackups('prod', { keep: '1y' })).toThrow(
			BackupRetentionInvalid,
		);
		expect(() =>
			checkStageBackups('prod', { every: '1d', cron: '0 2 * * *' }),
		).toThrow(BackupsEntryInvalid);
		expect(() => checkStageBackups('prod', { schedule: '1d' })).toThrow(
			BackupsEntryInvalid,
		);
		expect(() => checkStageBackups('prod', true)).toThrow(BackupsEntryInvalid);
	});

	it('is refused by the workspace schema with the same words, and only for a deployed stage', () => {
		const base = {
			name: 'shop',
			apps: { api: { type: 'backend', path: 'apps/api', port: 3000 } },
			stages: { local: 'dev', deployed: ['prod'] },
		};
		const invalid = WorkspaceConfigSchema.safeParse({
			...base,
			deploy: { backups: { prod: { every: '10m' } } },
		});
		expect(invalid.success).toBe(false);
		expect(JSON.stringify(invalid.error?.issues)).toContain(
			"deploy.backups.prod.every is '10m'",
		);

		const unknown = WorkspaceConfigSchema.safeParse({
			...base,
			deploy: { backups: { qa: { every: '1d' } } },
		});
		expect(unknown.success).toBe(false);

		expect(
			WorkspaceConfigSchema.safeParse({
				...base,
				deploy: { backups: { prod: { cron: '0 */6 * * *', keep: '7d' } } },
			}).success,
		).toBe(true);
	});
});

describe('where backups are kept', () => {
	it("is the stage's prefix, beside its deploy state", () => {
		expect(backupsPrefix(workspace(), 'prod')).toBe('gkm/shop/prod/backups');
		expect(
			backupsPrefix(
				workspace(undefined, {
					state: { provider: 's3', region: 'eu-west-1', prefix: 'infra/' },
				}),
				'prod',
			),
		).toBe('infra/shop/prod/backups');
	});

	it('is one folder per run, by day then time, read back exactly', () => {
		const at = new Date('2026-10-10T02:00:00.123Z');
		expect(runFolder(at)).toBe('2026-10-10/02-00-00Z');
		expect(runTime('2026-10-10/02-00-00Z')).toEqual(
			new Date('2026-10-10T02:00:00Z'),
		);
		expect(runTime('2026-10-10/.gkm-verify')).toBeUndefined();
	});

	it("expires every stage's backups by its own keep, and aborts what never finished", () => {
		expect(
			backupExpiries(workspace({ prod: { keep: '90d' } }), WITH_DATABASE),
		).toEqual([
			{
				id: 'gkm-backups-prod',
				prefix: 'gkm/shop/prod/backups/',
				days: 90,
				abortIncompleteDays: 1,
			},
			{
				id: 'gkm-backups-staging',
				prefix: 'gkm/shop/staging/backups/',
				days: 30,
				abortIncompleteDays: 1,
			},
		]);
	});
});

describe("the container's copy of the schedule", () => {
	it('runs when the deploy says it does', () => {
		const schedules = [
			checkStageBackups('prod', {}),
			checkStageBackups('prod', { every: '90m' }),
			checkStageBackups('prod', { cron: '15 */4 * * *' }),
			checkStageBackups('prod', { cron: '0 1 1,15 * 0' }),
			checkStageBackups('prod', { cron: '0 0 29 2 *' }),
		];
		const after = [
			'2026-01-01T00:00:00Z',
			'2026-02-28T23:59:30Z',
			'2026-10-10T02:00:00Z',
			'2027-12-31T23:00:00Z',
		];
		for (const backups of schedules) {
			if (!backups) return expect.unreachable();
			const { kind, ...rest } = backups.schedule;
			const shipped =
				kind === 'cron'
					? {
							kind,
							minutes: (rest as ReturnType<typeof parseCron>).minutes,
							hours: (rest as ReturnType<typeof parseCron>).hours,
							days: (rest as ReturnType<typeof parseCron>).days,
							months: (rest as ReturnType<typeof parseCron>).months,
							weekdays: (rest as ReturnType<typeof parseCron>).weekdays,
						}
					: backups.schedule;
			for (const at of after) {
				expect(
					runnerNextRun(JSON.parse(JSON.stringify(shipped)), new Date(at)),
				).toEqual(nextRun(backups.schedule, new Date(at)));
			}
		}
	});
});

describe('a schedule at its edges', () => {
	it('refuses a cron that never runs twice, and an entry whose value is not text', () => {
		expect(() => checkStageBackups('prod', { cron: '0 0 30 2 *' })).toThrow(
			/does not run twice in four years/,
		);
		expect(() => checkStageBackups('prod', { every: 6 })).toThrow(
			BackupsEntryInvalid,
		);
		expect(() => checkStageBackups('prod', null)).toThrow(BackupsEntryInvalid);
		expect(() => checkStageBackups('prod', [])).toThrow(BackupsEntryInvalid);
	});

	it('never runs a cron whose day does not exist', () => {
		expect(
			nextRun(
				parseCron('prod', '0 0 30 2 *'),
				new Date('2026-01-01T00:00:00Z'),
			),
		).toBeNull();
	});

	it('takes ranges, steps, lists and Sunday as 7', () => {
		const cron = parseCron('prod', '0,30 8-10/2 1-7 */6 7');
		expect(cron).toMatchObject({
			minutes: [0, 30],
			hours: [8, 10],
			days: [1, 2, 3, 4, 5, 6, 7],
			months: [1, 7],
			weekdays: [0],
		});
		expect(parseCron('prod', '0 2/12 * * *').hours).toEqual([2, 14]);
		expect(() => parseCron('prod', '0 2 * * MON')).toThrow(BackupCronInvalid);
		expect(() => parseCron('prod', '0 5-2 * * *')).toThrow(BackupCronInvalid);
		expect(() => parseCron('prod', '0 */0 * * *')).toThrow(BackupCronInvalid);
		expect(() => parseCron('prod', '0')).toThrow(/has 1 field, not five/);
	});

	it('describes itself the way the deploy prints it', () => {
		expect(
			checkStageBackups('prod', { every: '90m', keep: '7d' }),
		).toMatchObject({
			describe: 'every 90m from 02:00 UTC, kept 7 days',
		});
		expect(checkStageBackups('prod', { every: '2d' })).toMatchObject({
			describe: 'every 2d from 02:00 UTC, kept 30 days',
		});
		expect(checkStageBackups('prod', { cron: '0 */6 * * *' })).toMatchObject({
			describe: "cron '0 */6 * * *' (UTC), kept 30 days",
			maxGapSeconds: 21_600,
		});
	});
});
