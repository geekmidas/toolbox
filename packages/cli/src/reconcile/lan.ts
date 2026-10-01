/**
 * This machine's address on the local network — what a phone running the app
 * reaches it on.
 */

import { type NetworkInterfaceInfo, networkInterfaces } from 'node:os';

/**
 * The first private IPv4 address of an interface that is up and not loopback.
 *
 * Private ranges only (`10/8`, `172.16/12`, `192.168/16`): a public address
 * would mean listening for a phone on the open internet, and a link-local one
 * (`169.254/16`) is what an interface has when it found no network at all.
 * Undefined when there is none — a laptop on no network still runs, its mobile
 * app reaching only a simulator.
 */
export function lanAddress(
	interfaces: Record<
		string,
		NetworkInterfaceInfo[] | undefined
	> = networkInterfaces(),
): string | undefined {
	for (const entries of Object.values(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.family !== 'IPv4' || entry.internal) continue;
			if (isPrivate(entry.address)) return entry.address;
		}
	}
	return undefined;
}

function isPrivate(address: string): boolean {
	return (
		/^10\./.test(address) ||
		/^192\.168\./.test(address) ||
		/^172\.(1[6-9]|2\d|3[01])\./.test(address)
	);
}
