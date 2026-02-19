import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upgradeCommand } from '../index';

vi.mock('node:child_process', () => ({
	execSync: vi.fn(),
}));

const NPM_REGISTRY = 'https://registry.npmjs.org';

const server = setupServer();

function writePackageJson(dir: string, content: Record<string, unknown>) {
	writeFileSync(join(dir, 'package.json'), JSON.stringify(content, null, 2));
}

describe('upgradeCommand', () => {
	let tempDir: string;
	let originalCwd: string;

	beforeEach(async () => {
		tempDir = join(tmpdir(), `gkm-upgrade-test-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });
		originalCwd = process.cwd();
		process.chdir(tempDir);
		server.listen({ onUnhandledRequest: 'bypass' });
		vi.mocked(execSync).mockReset();
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		server.resetHandlers();
		server.close();
		await rm(tempDir, { recursive: true, force: true });
	});

	it('should report no packages found when none exist', async () => {
		writePackageJson(tempDir, {
			name: 'test-project',
			dependencies: { lodash: '^4.0.0' },
		});
		// Create a lockfile so detectPackageManager finds a root
		writeFileSync(join(tempDir, 'package-lock.json'), '{}');

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await upgradeCommand();

		const output = logSpy.mock.calls.flat().join('\n');
		expect(output).toContain('No @geekmidas packages found');

		logSpy.mockRestore();
	});

	it('should detect workspace refs and mark them as workspace status', async () => {
		writeFileSync(join(tempDir, 'package-lock.json'), '{}');
		writePackageJson(tempDir, {
			name: 'test-monorepo',
			workspaces: ['packages/*'],
			dependencies: {
				'@geekmidas/constructs': 'workspace:*',
			},
		});

		const pkgDir = join(tempDir, 'packages', 'api');
		await mkdir(pkgDir, { recursive: true });
		writePackageJson(pkgDir, {
			name: '@test/api',
			dependencies: {
				'@geekmidas/auth': 'workspace:~',
			},
		});

		server.use(
			http.get(`${NPM_REGISTRY}/@geekmidas/constructs/latest`, () => {
				return HttpResponse.json({ version: '1.1.1' });
			}),
			http.get(`${NPM_REGISTRY}/@geekmidas/auth/latest`, () => {
				return HttpResponse.json({ version: '1.0.0' });
			}),
		);

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await upgradeCommand();

		const output = logSpy.mock.calls.flat().join('\n');
		expect(output).toContain('workspace');
		expect(output).toContain('All @geekmidas packages are up to date');

		logSpy.mockRestore();
	});

	it('should identify packages that need upgrade', async () => {
		writeFileSync(join(tempDir, 'package-lock.json'), '{}');
		writePackageJson(tempDir, {
			name: 'test-project',
			dependencies: {
				'@geekmidas/constructs': '^1.0.0',
				'@geekmidas/auth': '~1.0.0',
			},
		});

		server.use(
			http.get(`${NPM_REGISTRY}/@geekmidas/constructs/latest`, () => {
				return HttpResponse.json({ version: '1.2.0' });
			}),
			http.get(`${NPM_REGISTRY}/@geekmidas/auth/latest`, () => {
				return HttpResponse.json({ version: '1.1.0' });
			}),
		);

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await upgradeCommand({ dryRun: true });

		const output = logSpy.mock.calls.flat().join('\n');
		expect(output).toContain('⬆ upgrade');
		expect(output).toContain('2 package(s) can be upgraded');
		expect(output).toContain('--dry-run: No changes made');
		expect(output).toContain('npm update');

		logSpy.mockRestore();
	});

	it('should report up-to-date when versions match', async () => {
		writeFileSync(join(tempDir, 'package-lock.json'), '{}');
		writePackageJson(tempDir, {
			name: 'test-project',
			dependencies: {
				'@geekmidas/errors': '1.0.0',
			},
		});

		server.use(
			http.get(`${NPM_REGISTRY}/@geekmidas/errors/latest`, () => {
				return HttpResponse.json({ version: '1.0.0' });
			}),
		);

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await upgradeCommand();

		const output = logSpy.mock.calls.flat().join('\n');
		expect(output).toContain('✓ up-to-date');
		expect(output).toContain('All @geekmidas packages are up to date');

		logSpy.mockRestore();
	});

	it('should execute upgrade command when not dry-run', async () => {
		writeFileSync(join(tempDir, 'package-lock.json'), '{}');
		writePackageJson(tempDir, {
			name: 'test-project',
			dependencies: {
				'@geekmidas/errors': '^1.0.0',
			},
		});

		server.use(
			http.get(`${NPM_REGISTRY}/@geekmidas/errors/latest`, () => {
				return HttpResponse.json({ version: '2.0.0' });
			}),
		);

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await upgradeCommand();

		expect(execSync).toHaveBeenCalledWith(
			expect.stringContaining('npm update @geekmidas/errors'),
			expect.objectContaining({ stdio: 'inherit' }),
		);

		logSpy.mockRestore();
	});

	it('should use pnpm update -r when pnpm is detected', async () => {
		writeFileSync(join(tempDir, 'pnpm-lock.yaml'), '');
		writePackageJson(tempDir, {
			name: 'test-project',
			dependencies: {
				'@geekmidas/logger': '^1.0.0',
			},
		});

		server.use(
			http.get(`${NPM_REGISTRY}/@geekmidas/logger/latest`, () => {
				return HttpResponse.json({ version: '2.0.0' });
			}),
		);

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await upgradeCommand();

		expect(execSync).toHaveBeenCalledWith(
			expect.stringContaining('pnpm update -r @geekmidas/logger --latest'),
			expect.anything(),
		);

		logSpy.mockRestore();
	});

	it('should scan all workspace packages in pnpm workspace', async () => {
		writeFileSync(join(tempDir, 'pnpm-lock.yaml'), '');
		writeFileSync(
			join(tempDir, 'pnpm-workspace.yaml'),
			'packages:\n  - "packages/*"\n  - "apps/*"\n',
		);
		writePackageJson(tempDir, {
			name: 'test-monorepo',
			devDependencies: {
				'@geekmidas/cli': '^1.0.0',
			},
		});

		const apiDir = join(tempDir, 'apps', 'api');
		await mkdir(apiDir, { recursive: true });
		writePackageJson(apiDir, {
			name: '@test/api',
			dependencies: {
				'@geekmidas/constructs': '^1.0.0',
			},
		});

		const libDir = join(tempDir, 'packages', 'shared');
		await mkdir(libDir, { recursive: true });
		writePackageJson(libDir, {
			name: '@test/shared',
			dependencies: {
				'@geekmidas/errors': '^1.0.0',
			},
		});

		server.use(
			http.get(`${NPM_REGISTRY}/@geekmidas/cli/latest`, () => {
				return HttpResponse.json({ version: '2.0.0' });
			}),
			http.get(`${NPM_REGISTRY}/@geekmidas/constructs/latest`, () => {
				return HttpResponse.json({ version: '2.0.0' });
			}),
			http.get(`${NPM_REGISTRY}/@geekmidas/errors/latest`, () => {
				return HttpResponse.json({ version: '2.0.0' });
			}),
		);

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await upgradeCommand({ dryRun: true });

		const output = logSpy.mock.calls.flat().join('\n');
		expect(output).toContain('Found 3 package(s) in workspace');
		expect(output).toContain('3 package(s) can be upgraded');

		logSpy.mockRestore();
	});

	it('should handle npm registry errors gracefully', async () => {
		writeFileSync(join(tempDir, 'package-lock.json'), '{}');
		writePackageJson(tempDir, {
			name: 'test-project',
			dependencies: {
				'@geekmidas/nonexistent': '^1.0.0',
			},
		});

		server.use(
			http.get(`${NPM_REGISTRY}/@geekmidas/nonexistent/latest`, () => {
				return new HttpResponse(null, { status: 404 });
			}),
		);

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await upgradeCommand();

		const output = logSpy.mock.calls.flat().join('\n');
		expect(output).toContain('unknown');

		logSpy.mockRestore();
	});

	it('should throw when execSync fails', async () => {
		writeFileSync(join(tempDir, 'package-lock.json'), '{}');
		writePackageJson(tempDir, {
			name: 'test-project',
			dependencies: {
				'@geekmidas/errors': '^1.0.0',
			},
		});

		server.use(
			http.get(`${NPM_REGISTRY}/@geekmidas/errors/latest`, () => {
				return HttpResponse.json({ version: '2.0.0' });
			}),
		);

		vi.mocked(execSync).mockImplementation(() => {
			throw new Error('command failed');
		});

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await expect(upgradeCommand()).rejects.toThrow('Package upgrade failed');

		logSpy.mockRestore();
	});

	it('should scan deps, devDeps, and peerDeps', async () => {
		writeFileSync(join(tempDir, 'package-lock.json'), '{}');
		writePackageJson(tempDir, {
			name: 'test-project',
			dependencies: {
				'@geekmidas/constructs': '^1.0.0',
			},
			devDependencies: {
				'@geekmidas/testkit': '^1.0.0',
			},
			peerDependencies: {
				'@geekmidas/logger': '^1.0.0',
			},
		});

		server.use(
			http.get(`${NPM_REGISTRY}/@geekmidas/constructs/latest`, () => {
				return HttpResponse.json({ version: '2.0.0' });
			}),
			http.get(`${NPM_REGISTRY}/@geekmidas/testkit/latest`, () => {
				return HttpResponse.json({ version: '2.0.0' });
			}),
			http.get(`${NPM_REGISTRY}/@geekmidas/logger/latest`, () => {
				return HttpResponse.json({ version: '2.0.0' });
			}),
		);

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await upgradeCommand({ dryRun: true });

		const output = logSpy.mock.calls.flat().join('\n');
		expect(output).toContain('Checking 3 unique @geekmidas package(s)');
		expect(output).toContain('3 package(s) can be upgraded');

		logSpy.mockRestore();
	});
});
