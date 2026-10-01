import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidStages } from '../../workspace/stages';
import { initCommand, NotAnAwsRegion, UnknownDeployTarget } from '../index';

/** What `process.exit` becomes here, so a refusal can be asserted on. */
class Exited extends Error {
	constructor(readonly code: number | undefined) {
		super(`process.exit(${code})`);
		this.name = 'Exited';
	}
}

/**
 * `gkm init` answered the way a person at a terminal would: every question
 * it asks, in order, through `prompts.inject` — so which questions appear, and
 * what each answer becomes, is what the tests see.
 */
describe('initCommand, answered interactively', () => {
	let dir: string;
	let home: string;
	let cwd: string;
	const originalHome = process.env.HOME;
	const read = (path: string) => readFileSync(join(dir, path), 'utf-8');

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'gkm-init-interactive-'));
		home = mkdtempSync(join(tmpdir(), 'gkm-init-home-'));
		cwd = process.cwd();
		process.chdir(dir);
		// Stage keys land under ~/.gkm; never the real one.
		process.env.HOME = home;
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Exited(code as number | undefined);
		});
	});

	afterEach(() => {
		process.chdir(cwd);
		process.env.HOME = originalHome;
		vi.restoreAllMocks();
		rmSync(dir, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	});

	it('asks for everything, and scaffolds an API from the answers', async () => {
		prompts.inject([
			'shop', // name
			'api', // template
			['database', 'cache'], // constructs
			'npm', // package manager
			'sst', // deploy target
			' af-south-1 ', // region, trimmed
			'staging, prod', // deployed stages
			'prod', // which is production: asked because there are two
			'dev', // local stage
			false, // Telescope
			'console', // logger
			'domain-based', // routes structure
			// No frontend question: this is not a fullstack template.
		]);

		await initCommand(undefined, { skipInstall: true });

		const config = read('shop/gkm.config.ts');
		expect(config).toContain("local: 'dev'");
		expect(config).toContain("deployed: ['staging', 'prod']");
		expect(config).toContain("protected: ['prod']");

		expect(read('shop/src/config/logger.ts')).toContain(
			'@geekmidas/logger/console',
		);
		const pkg = JSON.parse(read('shop/package.json'));
		expect(pkg.dependencies).not.toHaveProperty('@geekmidas/telescope');
		expect(existsSync(join(dir, 'shop/src/constructs/cache.ts'))).toBe(true);
		expect(existsSync(join(dir, 'shop/src/constructs/storage.ts'))).toBe(false);
		// Domain-based routes live beside their domain.
		expect(existsSync(join(dir, 'shop/src/users/routes'))).toBe(true);
		expect(existsSync(join(dir, 'shop/.gkm/secrets/dev.json'))).toBe(true);
	});

	it('scaffolds a fullstack workspace with the frontend it was asked for', async () => {
		prompts.inject([
			'fullstack', // template
			[], // constructs: none picked, but a fullstack app has a database
			'pnpm',
			'dokploy',
			'prod', // one deployed stage: no "which is production" question
			'local',
			true,
			'pino',
			'centralized-routes',
			'tanstack-start',
		]);

		await initCommand('shop', { skipInstall: true });

		expect(read('shop/gkm.config.ts')).toContain("protected: ['prod']");
		expect(existsSync(join(dir, 'shop/apps/web/src/routes'))).toBe(true);
		expect(existsSync(join(dir, 'shop/constructs/database.ts'))).toBe(true);
		expect(JSON.parse(read('shop/package.json')).scripts).toHaveProperty(
			'deploy:prod',
		);
	});

	it('takes what the flags already answered and asks only the rest', async () => {
		prompts.inject([
			['mail'], // constructs
			'yarn',
			true, // Telescope
			'pino',
			'centralized-endpoints',
		]);

		await initCommand('flagged', {
			template: 'api',
			deploy: 'sst',
			region: 'eu-west-1',
			stages: 'qa,prod',
			protectedStage: 'prod',
			localStage: 'dev',
			skipInstall: true,
		});

		const config = read('flagged/gkm.config.ts');
		expect(config).toContain("deployed: ['qa', 'prod']");
		expect(config).toContain("protected: ['prod']");
		expect(existsSync(join(dir, 'flagged/src/constructs/email.ts'))).toBe(true);
	});

	describe('refuses before writing anything', () => {
		it('an unknown deploy target or a malformed region', async () => {
			await expect(
				initCommand('x', { deploy: 'heroku' as never, yes: true }),
			).rejects.toThrow(UnknownDeployTarget);
			await expect(
				initCommand('x', { deploy: 'sst', region: 'europe', yes: true }),
			).rejects.toThrow(NotAnAwsRegion);
		});

		it('stage flags that break the rules gkm.config.ts is held to', async () => {
			await expect(
				initCommand('x', { stages: 'prod,prod', yes: true }),
			).rejects.toThrow(InvalidStages);
			await expect(
				initCommand('x', { stages: 'prod', localStage: 'prod', yes: true }),
			).rejects.toThrow(InvalidStages);
			await expect(
				initCommand('x', { stages: 'prod', protectedStage: 'qa', yes: true }),
			).rejects.toThrow('--protected-stage "qa" is not in --stages');
			expect(existsSync(join(dir, 'x'))).toBe(false);
		});

		it('a project name that is not one, or a directory already there', async () => {
			await expect(
				initCommand('Not A Name', { yes: true, skipInstall: true }),
			).rejects.toThrow(Exited);

			mkdirSync(join(dir, 'taken'));
			await expect(
				initCommand('taken', { yes: true, skipInstall: true }),
			).rejects.toThrow(Exited);
		});
	});
});
