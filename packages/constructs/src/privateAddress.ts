/**
 * Whether `address` is loopback or private: 127/8, 10/8, 172.16/12,
 * 192.168/16, 169.254/16, `::1`, `fc00::/7`, `fe80::/10`, and an IPv4 one
 * mapped into IPv6.
 */
export function isPrivateAddress(address: string | undefined): boolean {
	if (!address) return false;
	const ip = address.toLowerCase().replace(/^::ffff:/, '');

	const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return (
			a === 127 ||
			a === 10 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254)
		);
	}

	if (ip === '::1') return true;
	return /^f[cd][0-9a-f]{2}:/.test(ip) || /^fe[89ab][0-9a-f]:/.test(ip);
}
