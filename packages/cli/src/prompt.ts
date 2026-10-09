/**
 * Asking the person at the terminal.
 *
 * CLI layer only: a command's action may prompt, nothing it calls may. A
 * library call (`deploy()`) that needs something it was not given raises a
 * named error instead, and the command decides whether to ask.
 */

import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'node:readline/promises';
import { GkmError } from './errors';

/** A prompt was needed with no terminal to ask at. */
export class PromptNeedsTerminal extends GkmError {
	constructor(
		readonly question: string,
		/** What to do instead — the flag or variable that answers it. */
		readonly instead: string,
	) {
		super(`Interactive input required. ${instead}`);
		this.name = 'PromptNeedsTerminal';
	}
}

/** Whether there is a person at a terminal to ask. */
export function canPrompt(): boolean {
	return process.stdin.isTTY === true;
}

/**
 * Ask `message` and resolve with the line typed — without echoing it when
 * `hidden`. Ctrl+C at a hidden prompt exits, as it would anywhere else in a
 * terminal program: raw mode has taken the signal away from the shell.
 */
export async function prompt(
	message: string,
	options: { hidden?: boolean; instead: string },
): Promise<string> {
	if (!canPrompt()) {
		throw new PromptNeedsTerminal(message, options.instead);
	}

	if (options.hidden) {
		// For hidden input, use raw mode directly without readline
		process.stdout.write(message);

		return new Promise((resolve, reject) => {
			let value = '';

			const cleanup = () => {
				process.stdin.setRawMode(false);
				process.stdin.pause();
				process.stdin.removeListener('data', onData);
				process.stdin.removeListener('error', onError);
			};

			const onError = (err: Error) => {
				cleanup();
				reject(err);
			};

			const onData = (char: Buffer) => {
				const c = char.toString();

				if (c === '\n' || c === '\r') {
					cleanup();
					process.stdout.write('\n');
					resolve(value);
				} else if (c === '\u0003') {
					// Ctrl+C
					cleanup();
					process.stdout.write('\n');
					process.exit(1);
				} else if (c === '\u007F' || c === '\b') {
					// Backspace
					if (value.length > 0) {
						value = value.slice(0, -1);
					}
				} else {
					value += c;
				}
			};

			process.stdin.setRawMode(true);
			process.stdin.resume();
			process.stdin.on('data', onData);
			process.stdin.on('error', onError);
		});
	}

	// For visible input, use readline
	const rl = readline.createInterface({ input, output });
	try {
		return await rl.question(message);
	} finally {
		rl.close();
	}
}
