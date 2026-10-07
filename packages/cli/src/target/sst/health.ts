/**
 * Whether a released surface answers.
 *
 * The paths are the ones the local stack's healthchecks use
 * (`reconcile/apps.ts`): an API's `/health`, a site's `/`. A surface is
 * asked a few times, because a fresh deploy can take a moment to answer — a
 * Lambda's first start, a distribution still settling — and healthy means a
 * 2xx, after redirects.
 */

import type { TargetEvent } from '../types';

export interface HealthCheckOptions {
	/** How many times a surface is asked before it counts as down. */
	attempts: number;
	/** The wait between two attempts. */
	delayMs: number;
	/** How long one request may take. */
	timeoutMs: number;
	signal: AbortSignal;
	emit: (event: TargetEvent) => void;
}

/** Surfaces that never answered healthy. */
export class SurfacesUnhealthy extends Error {
	constructor(
		readonly stage: string,
		/** Each surface that failed, with the last thing it answered. */
		readonly surfaces: readonly {
			app: string;
			url: string;
			status?: number;
			error?: string;
		}[],
	) {
		const lines = surfaces.map(
			({ app, url, status, error }) =>
				`  - ${app}: ${url} → ${status ?? error ?? 'no answer'}`,
		);
		super(
			`The "${stage}" stage was deployed, but ${surfaces.length === 1 ? 'a surface does' : 'surfaces do'} not answer healthy:\n${lines.join('\n')}\nCheck its logs in CloudWatch, fix it, and deploy again.`,
		);
		this.name = 'SurfacesUnhealthy';
	}
}

/** `path` under `base`, keeping any path `base` already has. */
export function healthUrl(base: string, path: string): string {
	const root = base.endsWith('/') ? base : `${base}/`;
	return new URL(path.replace(/^\//, ''), root).toString();
}

/**
 * Ask `url` until it answers 2xx or the attempts run out, emitting
 * `health.checked` for each. Resolves with the last answer.
 */
export async function checkHealth(
	app: string,
	url: string,
	options: HealthCheckOptions,
): Promise<{ healthy: boolean; status?: number; error?: string }> {
	let last: { healthy: boolean; status?: number; error?: string } = {
		healthy: false,
	};
	for (let attempt = 1; attempt <= options.attempts; attempt++) {
		options.signal.throwIfAborted();
		try {
			const response = await fetch(url, {
				redirect: 'follow',
				signal: AbortSignal.any([
					options.signal,
					AbortSignal.timeout(options.timeoutMs),
				]),
			});
			// Drained, so the connection is not held open by an unread body.
			await response.arrayBuffer().catch(() => undefined);
			last = { healthy: response.ok, status: response.status };
		} catch (error) {
			// The run being stopped is not the surface being down.
			options.signal.throwIfAborted();
			last = {
				healthy: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
		options.emit({
			type: 'health.checked',
			app,
			url,
			healthy: last.healthy,
			...(last.status !== undefined ? { status: last.status } : {}),
			attempt,
		});
		if (last.healthy) return last;
		if (attempt < options.attempts) await wait(options.delayMs, options.signal);
	}
	return last;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', stop);
			resolve();
		}, ms);
		const stop = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		signal.addEventListener('abort', stop, { once: true });
	});
}
