/**
 * Generates an array of test records for benchmark data sets.
 *
 * @param count - Number of records to generate
 * @returns Array of test data objects
 */
export function generateTestData(
	count: number,
): Array<{ id: string; name: string; value: number }> {
	return Array.from({ length: count }, (_, i) => ({
		id: `id-${i}`,
		name: `Item ${i}`,
		value: Math.random() * 1000,
	}));
}

/**
 * Generates unique keys for cache benchmarks to avoid collisions.
 *
 * @param prefix - Key prefix
 * @param count - Number of keys to generate
 * @returns Array of unique cache keys
 */
export function generateCacheKeys(prefix: string, count: number): string[] {
	return Array.from({ length: count }, (_, i) => `${prefix}:${i}`);
}

/**
 * Generates IP addresses for rate limit benchmarks.
 *
 * @param count - Number of IPs to generate
 * @param subnet - Subnet prefix (default: '192.168.1')
 * @returns Array of IP addresses
 */
export function generateIpAddresses(
	count: number,
	subnet: string = '192.168.1',
): string[] {
	return Array.from({ length: count }, (_, i) => `${subnet}.${i % 256}`);
}

/**
 * Creates a random IP address for rate limit benchmarks.
 */
export function randomIpAddress(): string {
	const octet = () => Math.floor(Math.random() * 256);
	return `${octet()}.${octet()}.${octet()}.${octet()}`;
}
