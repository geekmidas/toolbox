/**
 * `--provider`, as it maps onto targets: `dokploy` still works and says so,
 * the providers that never deployed anything are gone, and the planned
 * targets are not here yet.
 */

import { describe, expect, it, vi } from 'vitest';
import { deployCli } from '../../deploy/cli';
import { DeployTargetNotYetSupported } from '../builtins';
import {
	ProviderRemoved,
	providerDeprecation,
	targetForProvider,
} from '../provider';

describe('targetForProvider', () => {
	it('maps dokploy to the dokploy target, with a deprecation warning', () => {
		const warn = vi.fn();

		expect(targetForProvider('dokploy', warn)).toBe('dokploy');
		expect(warn).toHaveBeenCalledOnce();
		expect(warn).toHaveBeenCalledWith(
			'--provider is deprecated; use --target dokploy.',
		);
		expect(providerDeprecation('dokploy')).toContain('--target dokploy');
	});

	it('removes docker, pointing to gkm docker and gkm compose', () => {
		const error = (() => {
			try {
				return targetForProvider('docker', () => {});
			} catch (e) {
				return e;
			}
		})();

		expect(error).toBeInstanceOf(ProviderRemoved);
		expect(error).toMatchObject({ provider: 'docker' });
		expect((error as Error).message).toContain('gkm docker');
		expect((error as Error).message).toContain('gkm compose');
	});

	it('removes aws-lambda, pointing to SST', () => {
		expect(() => targetForProvider('aws-lambda', () => {})).toThrow(
			ProviderRemoved,
		);
		expect(() => targetForProvider('aws-lambda', () => {})).toThrow(
			/sst deploy/,
		);
	});

	it.each([
		'vercel',
		'cloudflare',
	])('refuses %s as not yet supported', (provider) => {
		const warn = vi.fn();

		expect(() => targetForProvider(provider, warn)).toThrow(
			DeployTargetNotYetSupported,
		);
		// Refused, not deprecated: there is no --target to move to.
		expect(warn).not.toHaveBeenCalled();
	});
});

describe('gkm deploy --provider', () => {
	it.each([
		['docker', 'ProviderRemoved'],
		['aws-lambda', 'ProviderRemoved'],
		['vercel', 'DeployTargetNotYetSupported'],
		['cloudflare', 'DeployTargetNotYetSupported'],
	])('exits 1 for %s before loading anything', async (provider, name) => {
		const printed: string[] = [];
		vi.spyOn(console, 'error').mockImplementation((line) => {
			printed.push(String(line));
		});

		// A directory with no project: refused before it is ever looked at.
		const code = await deployCli({
			cwd: '/nonexistent',
			provider,
			stage: 'production',
		});

		expect(code).toBe(1);
		expect(printed.join('\n')).toContain(name);
		vi.restoreAllMocks();
	});

	it('takes --target over --provider when given both', async () => {
		const warned: string[] = [];
		vi.spyOn(console, 'warn').mockImplementation((line) => {
			warned.push(String(line));
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		// `docker` would be refused; --target wins, so the run gets as far as
		// looking for the project.
		const code = await deployCli(
			{
				cwd: '/nonexistent',
				target: 'dokploy',
				provider: 'docker',
				stage: 'production',
				json: true,
			},
			{ stdout: { write: () => true } },
		);

		expect(code).toBe(1);
		expect(warned).toEqual([]);
		vi.restoreAllMocks();
	});
});
