import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandFailed, CommandTimedOut, run, runOutput } from '../run';

/** Node itself, so the tests need no other program on the machine. */
const node = process.execPath;

describe('run', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'gkm-run-'));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('hands every value to the program as one argument, read by no shell', async () => {
		const out = join(dir, 'argv.json');
		const marker = join(dir, 'pwned');
		const hostile = [
			`v1; touch ${marker}`,
			`$(touch ${marker})`,
			`\`touch ${marker}\``,
			'two words',
			'--rm',
			'-t',
			'it\'s "quoted"',
		];

		await run(node, [
			'-e',
			'require("node:fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))',
			out,
			...hostile,
		]);

		expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(hostile);
		// Nothing above was executed.
		expect(() => readFileSync(marker)).toThrow();
	});

	it('raises CommandFailed with the exit code when the program fails', async () => {
		const failure = run(node, ['-e', 'process.exit(3)'], { stdio: 'ignore' });

		await expect(failure).rejects.toBeInstanceOf(CommandFailed);
		await expect(failure).rejects.toMatchObject({
			command: node,
			args: ['-e', 'process.exit(3)'],
			exitCode: 3,
		});
	});

	it('kills a program that outlives its timeout and raises CommandTimedOut', async () => {
		const pidFile = join(dir, 'pid');
		const started = Date.now();

		const hung = run(
			node,
			[
				'-e',
				'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)',
				pidFile,
			],
			{ timeoutMs: 1_000, stdio: 'ignore' },
		);

		await expect(hung).rejects.toBeInstanceOf(CommandTimedOut);
		await expect(hung).rejects.toMatchObject({ timeoutMs: 1_000 });
		expect(Date.now() - started).toBeLessThan(5_000);

		// The child is gone, not left running behind the rejection.
		const pid = Number(readFileSync(pidFile, 'utf8'));
		expect(() => process.kill(pid, 0)).toThrow(
			expect.objectContaining({ code: 'ESRCH' }),
		);
	});

	it('rejects with the spawn error when the program does not exist', async () => {
		await expect(
			run(join(dir, 'no-such-program'), [], { stdio: 'ignore' }),
		).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('resolves with what the program wrote to stdout, through runOutput', async () => {
		const output = await runOutput(node, [
			'-e',
			'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
			'$(id)',
		]);

		expect(JSON.parse(output)).toEqual(['$(id)']);
	});

	it('raises CommandFailed from runOutput too', async () => {
		await expect(
			runOutput(node, ['-e', 'process.exit(4)']),
		).rejects.toMatchObject({ name: 'CommandFailed', exitCode: 4 });
	});
});
