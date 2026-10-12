import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	loadComposeApp,
	SERVER_IPV4,
	writeComposeApp,
} from '../../../compose/__tests__/__helpers__/composeApp';
import { deployedStackSecrets } from '../../../compose/secrets';
import { loadWorkspaceSettings } from '../../../config';
import { secretsStoreFor } from '../../../secrets/store';
import type { EasCli, EasPlatform } from '../../eas';

/**
 * The compose fixture with a `MobileApp`, deployed: its `production` stage's
 * secrets as its first deploy left them, in a real store.
 */
export async function deployedMobileApp(
	dir: string,
	options: Parameters<typeof writeComposeApp>[1] = {},
	custom: Record<string, string> = {},
): Promise<void> {
	writeComposeApp(dir, { target: 'compose', mobile: true, ...options });
	const { workspace, manifest } = await loadComposeApp(dir);
	const { secrets } = deployedStackSecrets(
		workspace,
		'production',
		null,
		manifest,
	);
	const store = await secretsStoreFor(
		await loadWorkspaceSettings(dir),
		'production',
	);
	await store.write('production', {
		...secrets,
		custom: {
			...secrets.custom,
			AUTH_SECRET: 'the-production-signing-secret',
			BACKUPS_URL: 's3://K:S@backups?region=eu-west-1',
			GKM_SERVER_IPV4: SERVER_IPV4,
			...custom,
		},
	});
}

/** One call gkm made of `eas`. */
export type EasCall =
	| { op: 'setEnv'; environment: string; name: string; value: string }
	| { op: 'fingerprint'; platform: EasPlatform; profile: string }
	| { op: 'storeBuild'; platform: EasPlatform; fingerprint: string }
	| {
			op: 'build';
			platform: EasPlatform;
			profile: string;
			submit: boolean;
			wait: boolean;
	  }
	| {
			op: 'update';
			platform: EasPlatform;
			channel: string;
			environment: string;
			message: string;
	  };

/**
 * `eas` as a recorder: each platform's fingerprint is `fp-<platform>`, and a
 * store build exists for the fingerprints `builds` names.
 */
export function easRecorder(builds: Record<string, string> = {}) {
	const calls: EasCall[] = [];
	const eas: EasCli = {
		async setEnv(_dir, variable) {
			calls.push({ op: 'setEnv', ...variable });
		},
		async fingerprint(_dir, { platform, profile }) {
			calls.push({ op: 'fingerprint', platform, profile });
			return `fp-${platform}`;
		},
		async storeBuild(_dir, { platform, fingerprint }) {
			calls.push({ op: 'storeBuild', platform, fingerprint });
			return builds[fingerprint];
		},
		async build(_dir, options) {
			calls.push({ op: 'build', ...options });
		},
		async update(_dir, options) {
			calls.push({ op: 'update', ...options });
		},
	};
	return { eas, calls };
}

/**
 * An `eas` in the app's node_modules/.bin — where gkm looks first — that
 * records its arguments, prints `stdout` for the command named by its first
 * argument, and exits `exit`.
 */
export function easStandIn(
	appDir: string,
	options: {
		stdout?: Record<string, string>;
		exit?: number;
		/** Variables whose values it writes to `eas-env.txt`, as `KEY=value`. */
		env?: readonly string[];
	} = {},
): string {
	const bin = join(appDir, 'node_modules', '.bin');
	mkdirSync(bin, { recursive: true });
	const log = join(appDir, 'eas-args.txt');
	const cases = Object.entries(options.stdout ?? {})
		.map(([command, out]) => `  ${command}) printf '%s' '${out}' ;;`)
		.join('\n');
	writeFileSync(
		join(bin, 'eas'),
		`#!/bin/sh
printf '%s\\n' "$@" >> '${log}'
printf -- '---\\n' >> '${log}'
${(options.env ?? []).map((key) => `printf '%s\\n' "${key}=$${key}" >> '${join(appDir, 'eas-env.txt')}'`).join('\n')}
case "$1" in
${cases}
esac
echo 'not logged in' >&2
exit ${options.exit ?? 0}
`,
	);
	chmodSync(join(bin, 'eas'), 0o755);
	return log;
}

/** Each command the stand-in was run with, as its arguments. */
export function easStandInCalls(log: string, read: (path: string) => string) {
	return read(log)
		.split('---\n')
		.filter(Boolean)
		.map((call) => call.trim().split('\n'));
}
