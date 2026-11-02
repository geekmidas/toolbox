import { X509Certificate } from 'node:crypto';
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { createServer, request } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	ensureLocalAuthority,
	ensureLocalCertificate,
	issueLocalCertificate,
	LocalAuthorityDamaged,
	LocalCertificateWithoutNames,
	localAuthorityPaths,
	localCertificateNames,
	readLocalAuthority,
} from '../authority';

/** GET `/` from a server on this machine as `host`, trusting only `ca`. */
function get(port: number, host: string, ca: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const req = request(
			{ host: '127.0.0.1', port, servername: host, headers: { host }, ca },
			(res) => {
				let body = '';
				res.on('data', (chunk) => {
					body += chunk;
				});
				res.on('end', () => resolve(body));
			},
		);
		req.on('error', reject);
		req.end();
	});
}

describe('gkm’s local certificate authority', () => {
	let dir: string;
	const paths = () => localAuthorityPaths(join(dir, 'home'));

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'gkm-authority-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('is made once, in the CLI’s home, its key owner-only', async () => {
		const authority = await ensureLocalAuthority(paths());

		expect(authority.certFile).toBe(join(dir, 'home', 'ca', 'root.pem'));
		const root = new X509Certificate(authority.cert);
		expect(root.ca).toBe(true);
		expect(root.checkIssued(root)).toBe(true);
		expect((await stat(paths().keyFile)).mode & 0o777).toBe(0o600);

		const again = await ensureLocalAuthority(paths());
		expect(again.cert).toBe(authority.cert);
	});

	it('ends with one root when two commands make it at once', async () => {
		const [a, b, c] = await Promise.all([
			ensureLocalAuthority(paths()),
			ensureLocalAuthority(paths()),
			ensureLocalAuthority(paths()),
		]);

		expect(new Set([a.cert, b.cert, c.cert]).size).toBe(1);
		expect(await readLocalAuthority(paths())).toEqual(a);
	});

	it('refuses a directory whose key is gone, rather than making a new root', async () => {
		await mkdir(paths().dir, { recursive: true });
		await writeFile(paths().certFile, 'not a certificate');

		await expect(ensureLocalAuthority(paths())).rejects.toBeInstanceOf(
			LocalAuthorityDamaged,
		);
	});

	it('issues a certificate a TLS client verifies against the root alone', async () => {
		const authority = await ensureLocalAuthority(paths());
		const { cert, key } = issueLocalCertificate(
			authority,
			localCertificateNames('shop', ['api.shop.localhost']),
		);
		const server = createServer({ cert, key }, (req, res) => {
			res.end(`hello ${req.headers.host}`);
		});
		await new Promise<void>((resolve) =>
			server.listen(0, '127.0.0.1', resolve),
		);
		const { port } = server.address() as AddressInfo;

		try {
			expect(await get(port, 'api.shop.localhost', authority.cert)).toBe(
				'hello api.shop.localhost',
			);
			expect(await get(port, 'shop.localhost', authority.cert)).toBe(
				'hello shop.localhost',
			);
			// A name the certificate does not carry, and a root that did not
			// sign it, both fail.
			await expect(
				get(port, 'a.b.shop.localhost', authority.cert),
			).rejects.toThrow();
			const other = await ensureLocalAuthority(
				localAuthorityPaths(join(dir, 'other')),
			);
			await expect(
				get(port, 'api.shop.localhost', other.cert),
			).rejects.toThrow();
		} finally {
			server.close();
		}
	});

	it('names the project, every label under it, and any host those miss', () => {
		expect(
			localCertificateNames('shop', [
				'api.shop.localhost',
				'shop.localhost',
				'*.shop.localhost',
				'*.test.shop.localhost',
				'files.test.shop.localhost',
			]),
		).toEqual(['shop.localhost', '*.shop.localhost', '*.test.shop.localhost']);
		// Without a project, only the hosts: `*.localhost` is nobody's.
		expect(localCertificateNames('', ['uploads.localhost'])).toEqual([
			'uploads.localhost',
		]);
	});

	it('refuses to issue a certificate with no names', async () => {
		const authority = await ensureLocalAuthority(paths());

		expect(() => issueLocalCertificate(authority, [])).toThrow(
			LocalCertificateWithoutNames,
		);
	});

	describe('ensureLocalCertificate', () => {
		const file = () => join(dir, 'edge.pem');

		it('keeps the one in the file while it covers every name', async () => {
			const authority = await ensureLocalAuthority(paths());
			const names = localCertificateNames('shop', []);

			const first = await ensureLocalCertificate(authority, names, file());
			const second = await ensureLocalCertificate(authority, names, file());

			expect(first.issued).toBe(true);
			expect(second.issued).toBe(false);
			expect(second.cert).toBe(first.cert);
			// Certificate then key, one owner-only file.
			expect(await readFile(file(), 'utf-8')).toBe(`${first.cert}${first.key}`);
			expect((await stat(file())).mode & 0o777).toBe(0o600);
		});

		it('issues again for a name the kept one lacks', async () => {
			const authority = await ensureLocalAuthority(paths());
			await ensureLocalCertificate(authority, ['shop.localhost'], file());

			const wider = await ensureLocalCertificate(
				authority,
				['shop.localhost', 'other.localhost'],
				file(),
			);

			expect(wider.issued).toBe(true);
			expect(new X509Certificate(wider.cert).checkHost('other.localhost')).toBe(
				'other.localhost',
			);
		});

		it('issues again near the end of the kept one', async () => {
			const authority = await ensureLocalAuthority(paths());
			const names = ['shop.localhost'];
			await ensureLocalCertificate(authority, names, file(), {
				now: new Date(Date.now() - 350 * 24 * 60 * 60 * 1000),
			});

			const renewed = await ensureLocalCertificate(authority, names, file());

			expect(renewed.issued).toBe(true);
		});

		it('issues again when the authority is another', async () => {
			const authority = await ensureLocalAuthority(paths());
			const other = await ensureLocalAuthority(
				localAuthorityPaths(join(dir, 'other')),
			);
			await ensureLocalCertificate(other, ['shop.localhost'], file());

			const own = await ensureLocalCertificate(
				authority,
				['shop.localhost'],
				file(),
			);

			expect(own.issued).toBe(true);
			expect(
				new X509Certificate(own.cert).checkIssued(
					new X509Certificate(authority.cert),
				),
			).toBe(true);
		});
	});
});
