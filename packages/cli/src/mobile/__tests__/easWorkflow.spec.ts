import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { easSync } from '../eas';
import { easWorkflow, easWorkflowPath } from '../easWorkflow';
import type { MobileStage } from '../stage';
import { deployedMobileApp, easRecorder } from './__helpers__/mobileApp';

/**
 * A stage's EAS workflow: what `gkm publish` does, as EAS's own jobs — and
 * `gkm eas:sync` writing it beside eas.json.
 */

const prod: MobileStage = {
	stage: 'prod',
	environment: 'production',
	channel: 'prod',
	android: { track: 'internal', releaseStatus: 'draft' },
};

type Jobs = Record<
	string,
	{
		type: string;
		needs?: string[];
		if?: string;
		environment?: string;
		params?: Record<string, unknown>;
	}
>;

const workflow = (options: { release: boolean; iosSubmits: boolean }) =>
	parse(easWorkflow(prod, options)) as {
		name: string;
		on: unknown;
		jobs: Jobs;
	};

describe("a stage's EAS workflow", () => {
	it('updates where a store build has the native code, and builds and submits where none does', () => {
		const { jobs } = workflow({ release: true, iosSubmits: true });

		expect(jobs.fingerprint).toMatchObject({
			type: 'fingerprint',
			environment: 'production',
		});
		expect(jobs.get_android_build).toMatchObject({
			type: 'get-build',
			needs: ['fingerprint'],
			params: {
				fingerprint_hash:
					'${{ needs.fingerprint.outputs.android_fingerprint_hash }}',
				profile: 'prod',
				platform: 'android',
				distribution: 'store',
			},
		});
		// One path or the other, on the same output.
		expect(jobs.build_android).toMatchObject({
			type: 'build',
			needs: ['get_android_build'],
			if: '${{ !needs.get_android_build.outputs.build_id }}',
			params: { platform: 'android', profile: 'prod' },
		});
		expect(jobs.update_android).toMatchObject({
			type: 'update',
			needs: ['get_android_build'],
			if: '${{ needs.get_android_build.outputs.build_id }}',
			environment: 'production',
			params: { platform: 'android', channel: 'prod' },
		});
		expect(jobs.submit_android).toMatchObject({
			type: 'submit',
			needs: ['build_android'],
			params: {
				build_id: '${{ needs.build_android.outputs.build_id }}',
				profile: 'prod',
			},
		});
		expect(jobs.submit_ios?.params?.build_id).toBe(
			'${{ needs.build_ios.outputs.build_id }}',
		);
	});

	it('builds iOS without submitting it until its App Store Connect app is set', () => {
		const { jobs } = workflow({ release: true, iosSubmits: false });

		expect(jobs.build_ios).toBeDefined();
		expect(jobs.submit_ios).toBeUndefined();
		expect(jobs.submit_android).toBeDefined();
	});

	it('runs on a release tag for the released stage, on main for the rest', () => {
		expect(workflow({ release: true, iosSubmits: false }).on).toEqual({
			push: { tags: ['v*'] },
		});
		expect(workflow({ release: false, iosSubmits: false }).on).toEqual({
			push: { branches: ['main'] },
		});
	});
});

describe('gkm eas:sync writes the workflow', () => {
	let dir: string;

	beforeEach(async () => {
		dir = realpathSync(await createTempDir('gkm-eas-workflow-'));
		vi.stubEnv('GKM_HOME', join(dir, '.home'));
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		await cleanupDir(dir);
	});

	it('beside eas.json, for the stage, submitting iOS once it can', async () => {
		await deployedMobileApp(dir, { protected: ['production'] });
		const appDir = join(dir, 'apps', 'app');
		writeFileSync(
			join(appDir, 'eas.json'),
			JSON.stringify({ submit: { production: { ios: { ascAppId: '123' } } } }),
		);

		const result = await easSync(
			{ stage: 'production', cwd: appDir },
			easRecorder().eas,
		);

		expect(result.workflow).toEqual({
			path: easWorkflowPath('production'),
			changed: true,
		});
		const written = parse(
			readFileSync(
				join(appDir, '.eas/workflows/publish-production.yml'),
				'utf8',
			),
		);
		expect(written.on).toEqual({ push: { tags: ['v*'] } });
		expect(written.jobs.fingerprint.environment).toBe('production');
		expect(written.jobs.submit_ios).toBeDefined();

		// Again, unchanged.
		const again = await easSync(
			{ stage: 'production', cwd: appDir },
			easRecorder().eas,
		);
		expect(again.workflow.changed).toBe(false);
	});

	it('writes nothing on a dry run', async () => {
		await deployedMobileApp(dir);
		const appDir = join(dir, 'apps', 'app');

		const result = await easSync(
			{ stage: 'production', cwd: appDir, dryRun: true },
			easRecorder().eas,
		);

		expect(result.workflow.changed).toBe(true);
		expect(existsSync(join(appDir, '.eas'))).toBe(false);
	});
});
