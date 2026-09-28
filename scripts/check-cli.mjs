#!/usr/bin/env node
/**
 * The built `gkm` starts, and every command it registers answers `--help`.
 *
 * Nothing else ran the binary. Unit tests call the functions behind each
 * command, and coverage leaves the commander wiring out, so a mistake in the
 * wiring itself shipped: `init` registered `--region` twice, commander refused
 * the second at startup, and every command of every alpha from then on died
 * before doing anything. A registration error is thrown when the program is
 * built, so asking each command for its help is enough to find one.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'packages/cli/bin/gkm.mjs');

function gkm(...args) {
	const result = spawnSync(process.execPath, [bin, ...args], {
		encoding: 'utf-8',
		cwd: root,
	});
	return {
		ok: result.status === 0,
		output: `${result.stdout}${result.stderr}`.trim(),
	};
}

const top = gkm('--help');
if (!top.ok) {
	console.error(`gkm does not start:\n\n${top.output}`);
	process.exit(1);
}

const commands = top.output
	.slice(top.output.indexOf('Commands:'))
	.split('\n')
	.map((line) => line.match(/^ {2}([a-z][a-z:-]*)/)?.[1])
	.filter((name) => name && name !== 'help');

const failures = commands
	.map((name) => ({ name, ...gkm(name, '--help') }))
	.filter(({ ok }) => !ok);

if (failures.length) {
	for (const { name, output } of failures) {
		console.error(`gkm ${name} --help failed:\n${output}\n`);
	}
	process.exit(1);
}

console.log(`gkm starts, and all ${commands.length} commands answer --help.`);
