/**
 * Where the CLI's progress lines go.
 *
 * Commands write their progress through `output` rather than `console`. Run
 * from the terminal that is the same thing. Run inside `deploy()`, each line
 * goes to the run that wrote it instead — as an event its caller can iterate,
 * and to the logger it was handed — so a deploy embedded in another program
 * does not print over that program's own output.
 *
 * Carried by `AsyncLocalStorage` rather than passed down, because the lines
 * come from everywhere a deploy reaches — the Dockerfile generator, the env
 * sniffer, construct discovery — and two deploys running in one process must
 * not hear each other.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { format } from 'node:util';

/** How loud a line is. */
export type OutputLevel = 'info' | 'warn' | 'error';

/** Receives each line written while it is the current sink. */
export type OutputSink = (level: OutputLevel, message: string) => void;

const current = new AsyncLocalStorage<OutputSink>();

/** Runs `fn` with every line written through `output` sent to `sink`. */
export function withOutput<T>(sink: OutputSink, fn: () => T): T {
	return current.run(sink, fn);
}

function write(
	level: OutputLevel,
	fallback: (...args: unknown[]) => void,
): (...args: unknown[]) => void {
	return (...args) => {
		const sink = current.getStore();
		if (sink) sink(level, format(...args));
		else fallback(...args);
	};
}

/**
 * `console`, for the methods the CLI logs through — routed to the current
 * run's sink when there is one.
 */
export const output = {
	log: write('info', (...args) => console.log(...args)),
	info: write('info', (...args) => console.info(...args)),
	warn: write('warn', (...args) => console.warn(...args)),
	error: write('error', (...args) => console.error(...args)),
};
