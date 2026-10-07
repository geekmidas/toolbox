/**
 * Whether a released app answers.
 *
 * Dokploy finishing a deployment means the service was updated, not that the
 * process in it is serving: a container that exits on start, a missing
 * variable read at boot, a database it cannot reach all look like a finished
 * deployment. So an app counts as released once its own health route has
 * answered 2xx several times in a row — one lucky answer from a container
 * about to crash-loop is not enough.
 */

import type { TargetEvent } from '../types';

/** What the health check of one app is. */
export interface HealthCheck {
	app: string;
	/** `https://<host><path>`. */
	url: string;
	/** Consecutive 2xx answers that make the app healthy. */
	healthyAfter: number;
	/** Between checks. */
	intervalMs: number;
	/** How long the app may take to become healthy. */
	timeoutMs: number;
	signal: AbortSignal;
	emit: (event: TargetEvent) => void;
}

/** How long one request may take: a check that hangs is a failed check. */
const REQUEST_TIMEOUT_MS = 10_000;

/** An app never answered healthy enough times in a row. */
export class HealthCheckTimedOut extends Error {
	constructor(
		readonly app: string,
		readonly url: string,
		readonly timeoutMs: number,
		/** The last answer's status, or undefined when the last request failed. */
		readonly lastStatus: number | undefined,
	) {
		super(
			`${app} did not become healthy within ${Math.round(timeoutMs / 1000)}s: ${url} last ` +
				`${lastStatus === undefined ? 'did not answer' : `answered ${lastStatus}`}. ` +
				"Check the app's logs in Dokploy. If it is only slow to start, raise deploy.dokploy.verify.healthTimeoutMs; " +
				'if it serves its health route elsewhere, set deploy.dokploy.verify.healthCheckPath.',
		);
		this.name = 'HealthCheckTimedOut';
	}
}

/** Wait `ms`, or reject with the signal's reason once it aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(signal.reason);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

/** One request: its status, or undefined when it never answered. */
async function probe(
	url: string,
	signal: AbortSignal,
): Promise<number | undefined> {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.any([
				signal,
				AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			]),
		});
		// Only the status is read. Not awaited: a cancel can wait on a body
		// that never ends, and the check is already answered.
		response.body?.cancel().catch(() => {});
		return response.status;
	} catch {
		// The run stopping is not a failed check.
		signal.throwIfAborted();
		return undefined;
	}
}

/**
 * Check `url` until it answers 2xx `healthyAfter` times in a row, emitting
 * `health.checked` for every check.
 *
 * @throws {HealthCheckTimedOut} when that has not happened within `timeoutMs`.
 */
export async function verifyHealth(check: HealthCheck): Promise<void> {
	const { app, url, healthyAfter, intervalMs, timeoutMs, signal, emit } = check;
	const deadline = Date.now() + timeoutMs;
	let consecutive = 0;
	let attempt = 0;

	while (true) {
		attempt++;
		const status = await probe(url, signal);
		const healthy = status !== undefined && status >= 200 && status < 300;
		emit({
			type: 'health.checked',
			app,
			url,
			healthy,
			...(status !== undefined ? { status } : {}),
			attempt,
		});

		consecutive = healthy ? consecutive + 1 : 0;
		if (consecutive >= healthyAfter) return;

		if (Date.now() + intervalMs > deadline) {
			throw new HealthCheckTimedOut(app, url, timeoutMs, status);
		}
		await sleep(intervalMs, signal);
	}
}
