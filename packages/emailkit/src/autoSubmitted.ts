/**
 * RFC 3834's `Auto-Submitted` header: what stops two automatic responders
 * answering each other forever.
 *
 * Mail an app sends while it is handling mail it received is marked
 * `auto-replied`, and mail that arrives already marked is not handled. Both
 * sides are here, so the sender and the receiver read the header the same way.
 *
 * Which sends are replies is a property of where they happen, not of the call,
 * so it is carried by an `AsyncLocalStorage`: everything a handler awaits,
 * however deep, sends marked mail. The storage lives on `globalThis` so a copy
 * of this module loaded as CJS and another loaded as ESM share it.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export const AUTO_SUBMITTED_HEADER = 'Auto-Submitted';

/** The values RFC 3834 defines; `no` is the only one meaning "a person sent it". */
export type AutoSubmitted = 'no' | 'auto-generated' | 'auto-replied';

const STORE = Symbol.for('@geekmidas/emailkit/autoSubmitted');

function storage(): AsyncLocalStorage<AutoSubmitted> {
	const scope = globalThis as unknown as Record<
		symbol,
		AsyncLocalStorage<AutoSubmitted> | undefined
	>;
	scope[STORE] ??= new AsyncLocalStorage<AutoSubmitted>();
	return scope[STORE];
}

/** Runs `fn` so that every message it sends is marked `auto-replied`. */
export function autoReplying<T>(fn: () => T): T {
	return storage().run('auto-replied', fn);
}

/** What mail sent from here should be marked, if anything. */
export function currentAutoSubmitted(): AutoSubmitted | undefined {
	return storage().getStore();
}

/**
 * Whether a message was sent automatically: its `Auto-Submitted` header is
 * present and anything but `no`. Parameters after `;` are ignored, and so is
 * case, as the RFC says.
 *
 * `headers` is keyed by lower-case name, as `parseEmail` returns them.
 */
export function isAutoSubmitted(
	headers: Readonly<Record<string, readonly string[] | undefined>>,
): boolean {
	return (headers[AUTO_SUBMITTED_HEADER.toLowerCase()] ?? []).some(
		(value) => value.split(';')[0]!.trim().toLowerCase() !== 'no',
	);
}
