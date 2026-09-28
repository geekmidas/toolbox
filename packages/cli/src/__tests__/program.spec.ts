import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const bin = join(import.meta.dirname, '..', '..', 'bin', 'gkm.mjs');

/**
 * The commander wiring is excluded from coverage — each action calls a function
 * tested on its own — so nothing else loads the program. A command that
 * registers an option twice makes commander throw while the program is being
 * built, which kills every `gkm` command, `--help` included: alpha.16 shipped
 * `init --region` twice and no scaffold could build.
 */
describe('the gkm program', () => {
	it('builds every command and prints its help', () => {
		const help = execFileSync(process.execPath, [bin, '--help'], {
			encoding: 'utf-8',
		});

		expect(help).toContain('Usage: gkm');
		expect(help).toContain('init');
	});

	it('lists each init option once', () => {
		const help = execFileSync(process.execPath, [bin, 'init', '--help'], {
			encoding: 'utf-8',
		});

		for (const flag of ['--region', '--deploy', '--stages']) {
			expect(help.split(flag).length - 1, flag).toBe(1);
		}
	});
});
