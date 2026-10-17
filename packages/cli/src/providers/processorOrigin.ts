/**
 * A file server's processors as a CDN origin: the names both sides agree on.
 *
 * On a compose stage whose bucket is on S3, the CDN serves the bucket and
 * sends each processor pattern to the stack's processor unit, at a host of
 * its own. That host is public — a CDN reaches its origin over the internet —
 * so the CDN adds a secret header and the edge refuses any request without
 * it. One definition, read by the CDN that sends the header and by the stack
 * whose edge checks it, so the two cannot drift.
 */

import { randomBytes } from 'node:crypto';
import { provideKey } from '@geekmidas/manifest';
import { appKey } from '../workspace/derive.js';

/** The header the CDN adds to every request it sends a processor. */
export const ORIGIN_VERIFY_HEADER = 'X-Gkm-Origin-Verify';

/** Where a file server's processors answer the CDN: `<fileserver>-processors.<domain>`. */
export function processorOriginHost(serverId: string, domain: string): string {
	return `${appKey(serverId)}-processors.${domain}`.toLowerCase();
}

/** The stage secret holding the header's value: `ASSETS_SERVER_ORIGIN_SECRET`. */
export function originSecretKey(serverId: string): string {
	return provideKey(serverId, 'originSecret');
}

/**
 * What the processor unit reads that secret from. Set wherever the CDN fronts
 * it, so the unit refuses a request without the header itself — on Dokploy,
 * whose edge cannot match a header, the only check; behind the stack's own
 * edge, a second one.
 */
export const PROCESSOR_ORIGIN_SECRET_ENV = 'GKM_PROCESSOR_ORIGIN_SECRET';

/** A new value for that secret: random, generated once, kept in the stage. */
export function newOriginSecret(): string {
	return randomBytes(32).toString('base64url');
}
