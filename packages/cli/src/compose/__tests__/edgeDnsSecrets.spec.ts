import { edgeDnsSecretPath } from '@geekmidas/edge/proxy/traefik';
import { describe, expect, it } from 'vitest';
import { isStackKey } from '../../secrets/stackKeys';
import {
	AcmeDnsSecretsMissing,
	acmeDnsZone,
	ensureEdgeDnsSecrets,
} from '../acmeDns';
import type { StackRef } from '../docker';
import { fakeDocker } from './__helpers__/fakeDocker';

/**
 * A DNS provider's keys for the shared edge's DNS challenge, from the stage's
 * own secrets, written into an edge whose files are kept in memory.
 */

const EDGE: StackRef = {
	project: 'gkm-edge',
	file: '/tmp/edge.yml',
	cwd: '/tmp',
};
const ZONE = { provider: 'godaddy', domain: 'aqora.dev' } as const;
const KEYS = {
	GODADDY_API_KEY: 'the-godaddy-api-key',
	GODADDY_API_SECRET: 'the-godaddy-api-secret',
};

/** An edge whose files are a map, and whose restarts are counted. */
function edge(files = new Map<string, string>()) {
	let restarts = 0;
	const modes = new Map<string, string>();
	const { docker } = fakeDocker({
		exec: (_stack, _service, command, input) => {
			if (command[0] === 'cat') {
				const content = files.get(command[1]!);
				return content === undefined
					? { code: 1, stdout: '', stderr: 'No such file' }
					: { code: 0, stdout: content, stderr: '' };
			}
			if (command[0] === 'kill') {
				restarts++;
				return { code: 0, stdout: '', stderr: '' };
			}
			if (command[0] === 'sh' && command[2]?.includes('cat >')) {
				files.set(command[4]!, input ?? '');
				modes.set(command[4]!, command[5]!);
			}
			return { code: 0, stdout: '', stderr: '' };
		},
	});
	return { docker, files, modes, restarts: () => restarts };
}

describe("a DNS provider's keys in the shared edge", () => {
	it('writes each key to its own file, readable by the edge alone', async () => {
		const { docker, files, modes, restarts } = edge();

		const written = await ensureEdgeDnsSecrets(docker, {
			edge: EDGE,
			zone: ZONE,
			stage: 'staging',
			custom: { ...KEYS, AUTH_SECRET: 'not-the-edges' },
			log: () => {},
		});

		expect(written).toBe(true);
		expect(Object.fromEntries(files)).toEqual({
			[edgeDnsSecretPath('GODADDY_API_KEY')]: 'the-godaddy-api-key',
			[edgeDnsSecretPath('GODADDY_API_SECRET')]: 'the-godaddy-api-secret',
		});
		for (const path of files.keys()) expect(modes.get(path)).toBe('600');
		// Nothing the edge had read before: no restart.
		expect(restarts()).toBe(0);
	});

	it('leaves keys the edge holds alone', async () => {
		const { docker, files, restarts } = edge(
			new Map([
				[edgeDnsSecretPath('GODADDY_API_KEY'), KEYS.GODADDY_API_KEY],
				[edgeDnsSecretPath('GODADDY_API_SECRET'), KEYS.GODADDY_API_SECRET],
			]),
		);

		const written = await ensureEdgeDnsSecrets(docker, {
			edge: EDGE,
			zone: ZONE,
			stage: 'staging',
			custom: KEYS,
			log: () => {},
		});

		expect(written).toBe(false);
		expect(files.size).toBe(2);
		expect(restarts()).toBe(0);
	});

	it('replaces a rotated key, and restarts the edge to read it', async () => {
		const { docker, files, restarts } = edge(
			new Map([
				[edgeDnsSecretPath('GODADDY_API_KEY'), 'the-old-key'],
				[edgeDnsSecretPath('GODADDY_API_SECRET'), KEYS.GODADDY_API_SECRET],
			]),
		);

		await ensureEdgeDnsSecrets(docker, {
			edge: EDGE,
			zone: ZONE,
			stage: 'staging',
			custom: KEYS,
			log: () => {},
		});

		expect(files.get(edgeDnsSecretPath('GODADDY_API_KEY'))).toBe(
			KEYS.GODADDY_API_KEY,
		);
		expect(restarts()).toBe(1);
	});

	it('writes nothing on a dry run', async () => {
		const { docker, files } = edge();
		const lines: string[] = [];

		await ensureEdgeDnsSecrets(docker, {
			edge: EDGE,
			zone: ZONE,
			stage: 'staging',
			custom: KEYS,
			dryRun: true,
			log: (line) => lines.push(line),
		});

		expect(files.size).toBe(0);
		expect(lines.join('\n')).toContain('dry run');
		expect(lines.join('\n')).not.toContain(KEYS.GODADDY_API_KEY);
	});

	it('refuses a stage without them, naming each and how to set it', async () => {
		const { docker, files } = edge();
		const ensure = () =>
			ensureEdgeDnsSecrets(docker, {
				edge: EDGE,
				zone: ZONE,
				stage: 'staging',
				custom: { GODADDY_API_KEY: KEYS.GODADDY_API_KEY },
				log: () => {},
			});

		await expect(ensure()).rejects.toThrow(AcmeDnsSecretsMissing);
		await expect(ensure()).rejects.toThrow(
			"gkm secrets:set GODADDY_API_SECRET '<value>' --stage staging",
		);
		expect(files.size).toBe(0);
	});

	it('are never handed to an app process', () => {
		expect(isStackKey('GODADDY_API_KEY')).toBe(true);
		expect(isStackKey('GODADDY_API_SECRET')).toBe(true);
	});
});

describe("the stage's DNS-challenge zone", () => {
	it('is the root domain holding the stage domain, through a provider the edge answers with', () => {
		expect(
			acmeDnsZone(
				{
					domains: { staging: 'aqora.dev', prod: 'aqora.cloud' },
					dns: {
						'aqora.dev': { provider: 'godaddy' },
						'aqora.cloud': { provider: 'godaddy' },
					},
				},
				'prod',
			),
		).toEqual({
			domain: 'aqora.cloud',
			zone: 'aqora.cloud',
			provider: 'godaddy',
			config: { provider: 'godaddy' },
		});
		expect(
			acmeDnsZone(
				{
					domains: { production: 'shop.example.com' },
					dns: { 'example.com': { provider: 'route53' } },
				},
				'production',
			),
		).toMatchObject({ zone: 'example.com', provider: 'route53' });
	});

	it('is none for a provider the edge cannot answer with, or no dns entry', () => {
		expect(
			acmeDnsZone(
				{
					domains: { production: 'shop.example.com' },
					dns: { 'example.com': { provider: 'manual' } },
				},
				'production',
			),
		).toBeUndefined();
		expect(
			acmeDnsZone(
				{ domains: { production: 'shop.example.com' } },
				'production',
			),
		).toBeUndefined();
	});
});
