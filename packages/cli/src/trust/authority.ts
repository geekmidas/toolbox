/**
 * gkm's local certificate authority: one per machine, and every local edge's
 * certificate is issued from it.
 *
 * `gkm dev`'s Caddy, a local `gkm compose` stack's Caddy — and anything else
 * that serves the local stage's `*.localhost` names — serves a certificate
 * this module issued, the way a deployed stage's edge serves the files
 * `deploy.compose.tls` names. So there is one root to trust (`gkm trust`), it
 * exists before any container starts, and a container that calls the stage's
 * public hosts can be handed it (`NODE_EXTRA_CA_CERTS`) without first copying
 * it out of a proxy.
 *
 * The root lives in the CLI's home (`GKM_HOME`, else `~/.gkm`), outside every
 * project. Its key never leaves that directory: only certificates it signed —
 * and their own keys — are written to a workspace or handed to a container.
 */

import {
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	randomBytes,
} from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import forge from 'node-forge';
import { GkmError } from '../errors';
import { gkmHome } from '../home';

/** Where the authority's files are. */
export interface LocalAuthorityPaths {
	dir: string;
	/** The root certificate, PEM — the only file anything else is handed. */
	certFile: string;
	/** The root's private key, PEM. Owner-only, and never copied anywhere. */
	keyFile: string;
}

/** The authority, loaded: its root certificate and the key it signs with. */
export interface LocalAuthority {
	certFile: string;
	/** The root certificate, PEM. */
	cert: string;
	/** The root's private key, PEM. */
	key: string;
}

/** A certificate the authority issued, and its key, both PEM. */
export interface LocalCertificate {
	cert: string;
	key: string;
}

/** How long the root is good for: ten years, so it is trusted once. */
const AUTHORITY_DAYS = 3650;

/**
 * How long an issued certificate is good for. Under Apple's 825-day limit
 * for a root a user added, and renewed long before it ends.
 */
export const CERTIFICATE_DAYS = 365;

/** An issued certificate this close to its end is issued again. */
const RENEW_WITHIN_DAYS = 30;

const DAY = 24 * 60 * 60 * 1000;

/** The authority's files, under the CLI's home. */
export function localAuthorityPaths(home = gkmHome()): LocalAuthorityPaths {
	const dir = join(home, 'ca');
	return {
		dir,
		certFile: join(dir, 'root.pem'),
		keyFile: join(dir, 'root-key.pem'),
	};
}

/** The authority's directory is there, and its root or key is not readable. */
export class LocalAuthorityDamaged extends GkmError {
	constructor(
		readonly dir: string,
		readonly reason: string,
	) {
		super(
			`gkm's local certificate authority in ${dir} cannot be used: ${reason}. ` +
				`Delete the directory and run "gkm trust" to make a new one — ` +
				`a browser that trusted the old root has to trust the new one.`,
		);
		this.name = 'LocalAuthorityDamaged';
	}
}

/** A certificate asked for with no names to put on it. */
export class LocalCertificateWithoutNames extends GkmError {
	constructor() {
		super(
			'A local certificate needs at least one host name. Pass the hosts the ' +
				'edge serves — localCertificateNames(project, hosts) lists them.',
		);
		this.name = 'LocalCertificateWithoutNames';
	}
}

/**
 * Load the authority, creating it the first time.
 *
 * Created whole or not at all: generated into a directory of its own and
 * renamed into place, so two commands starting at once — `gkm dev` for two
 * apps — end with one root between them, never one's certificate and the
 * other's key.
 *
 * @throws {LocalAuthorityDamaged} when its directory holds no usable root.
 */
export async function ensureLocalAuthority(
	paths: LocalAuthorityPaths = localAuthorityPaths(),
): Promise<LocalAuthority> {
	if (!existsSync(paths.dir)) await createAuthority(paths);
	return readLocalAuthority(paths);
}

/**
 * Load an authority that exists.
 *
 * @throws {LocalAuthorityDamaged} when its root or key is missing or unreadable.
 */
export async function readLocalAuthority(
	paths: LocalAuthorityPaths = localAuthorityPaths(),
): Promise<LocalAuthority> {
	let cert: string;
	let key: string;
	try {
		[cert, key] = await Promise.all([
			readFile(paths.certFile, 'utf-8'),
			readFile(paths.keyFile, 'utf-8'),
		]);
	} catch {
		throw new LocalAuthorityDamaged(
			paths.dir,
			'its root certificate or key is missing',
		);
	}
	try {
		const root = forge.pki.certificateFromPem(cert);
		const signer = forge.pki.privateKeyFromPem(key) as forge.pki.rsa.PrivateKey;
		const publicKey = root.publicKey as forge.pki.rsa.PublicKey;
		if (!publicKey.n.equals(signer.n)) {
			throw new LocalAuthorityDamaged(
				paths.dir,
				'its key is not the root certificate’s',
			);
		}
	} catch (error) {
		if (error instanceof LocalAuthorityDamaged) throw error;
		throw new LocalAuthorityDamaged(paths.dir, 'its files are not PEM');
	}
	return { certFile: paths.certFile, cert, key };
}

async function createAuthority(paths: LocalAuthorityPaths): Promise<void> {
	const { cert, key } = selfSigned();
	const staging = `${paths.dir}.${process.pid}.${randomBytes(4).toString('hex')}`;
	await mkdir(staging, { recursive: true, mode: 0o700 });
	try {
		await writeFile(join(staging, 'root.pem'), cert, { mode: 0o644 });
		await writeFile(join(staging, 'root-key.pem'), key, { mode: 0o600 });
		await mkdir(dirname(paths.dir), { recursive: true });
		await rename(staging, paths.dir).catch((error: NodeJS.ErrnoException) => {
			// Another command made it first: theirs is the machine's root.
			if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
		});
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

/** A new root: who made it, on which machine, so a keychain says whose it is. */
function selfSigned(): LocalCertificate {
	const { privateKey, publicKey } = keyPair();
	const cert = forge.pki.createCertificate();
	cert.publicKey = publicKey;
	cert.serialNumber = serialNumber();
	const now = Date.now();
	cert.validity.notBefore = new Date(now - DAY);
	cert.validity.notAfter = new Date(now + AUTHORITY_DAYS * DAY);
	const subject = utf8([
		{ name: 'organizationName', value: 'gkm local CA' },
		{ name: 'organizationalUnitName', value: owner() },
		{ name: 'commonName', value: `gkm local CA ${owner()}` },
	]);
	cert.setSubject(subject);
	cert.setIssuer(subject);
	cert.setExtensions([
		{
			name: 'basicConstraints',
			cA: true,
			pathLenConstraint: 0,
			critical: true,
		},
		{ name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
		{ name: 'subjectKeyIdentifier' },
	]);
	cert.sign(privateKey, forge.md.sha256.create());
	return {
		cert: forge.pki.certificateToPem(cert),
		key: forge.pki.privateKeyToPem(privateKey),
	};
}

/**
 * The names a project's local certificate carries: its bare host and every
 * label under it — `shop.localhost`, `*.shop.localhost` — and any host the
 * edge serves that those do not cover, a stage's own wildcard among them.
 * Without a project, the hosts alone: `*.localhost` is nobody's to claim.
 */
export function localCertificateNames(
	project: string,
	hosts: readonly string[],
): string[] {
	const base = project
		? [`${project}.localhost`, `*.${project}.localhost`]
		: [];
	const names = [...base];
	for (const host of hosts) {
		const name = host.toLowerCase();
		if (!names.some((covering) => covers(covering, name))) names.push(name);
	}
	return names;
}

/** Whether a certificate name answers for a host, by the one-label wildcard rule. */
function covers(name: string, host: string): boolean {
	if (name === host) return true;
	if (!name.startsWith('*.') || host.startsWith('*.')) return false;
	const suffix = name.slice(1);
	return host.endsWith(suffix) && !host.slice(0, -suffix.length).includes('.');
}

/**
 * A certificate for `names`, signed by the authority. Each call makes a new
 * key; {@link ensureLocalCertificate} is what keeps one across runs.
 *
 * @throws {LocalCertificateWithoutNames} for an empty list.
 */
export function issueLocalCertificate(
	authority: LocalAuthority,
	names: readonly string[],
	options: { now?: Date; days?: number } = {},
): LocalCertificate {
	if (names.length === 0) throw new LocalCertificateWithoutNames();
	const root = forge.pki.certificateFromPem(authority.cert);
	const signer = forge.pki.privateKeyFromPem(authority.key);
	const { privateKey, publicKey } = keyPair();
	const now = (options.now ?? new Date()).getTime();

	const cert = forge.pki.createCertificate();
	cert.publicKey = publicKey;
	cert.serialNumber = serialNumber();
	cert.validity.notBefore = new Date(now - 60 * 60 * 1000);
	cert.validity.notAfter = new Date(
		now + (options.days ?? CERTIFICATE_DAYS) * DAY,
	);
	cert.setSubject(
		utf8([
			{ name: 'organizationName', value: 'gkm local certificate' },
			{ name: 'commonName', value: names[0]! },
		]),
	);
	cert.setIssuer(root.subject.attributes);
	cert.setExtensions([
		{ name: 'basicConstraints', cA: false, critical: true },
		{
			name: 'keyUsage',
			digitalSignature: true,
			keyEncipherment: true,
			critical: true,
		},
		{ name: 'extKeyUsage', serverAuth: true },
		{
			name: 'subjectAltName',
			altNames: names.map((value) => ({ type: 2, value })),
		},
		{ name: 'subjectKeyIdentifier' },
		{
			name: 'authorityKeyIdentifier',
			keyIdentifier: root.generateSubjectKeyIdentifier().getBytes(),
		},
	]);
	cert.sign(signer, forge.md.sha256.create());
	return {
		cert: forge.pki.certificateToPem(cert),
		key: forge.pki.privateKeyToPem(privateKey),
	};
}

/**
 * The certificate for `names` kept in `file` — certificate then key, one PEM
 * file, which is what a proxy given the same path for both reads — issued
 * again only when the one there is not the authority's, does not cover every
 * name, or is near its end.
 *
 * One file written by rename, so two commands issuing at once leave a pair
 * that matches, never one's certificate beside the other's key.
 *
 * @throws {LocalCertificateWithoutNames} for an empty list.
 */
export async function ensureLocalCertificate(
	authority: LocalAuthority,
	names: readonly string[],
	file: string,
	options: { now?: Date } = {},
): Promise<LocalCertificate & { issued: boolean }> {
	const now = options.now ?? new Date();
	const existing = await readFile(file, 'utf-8').catch(() => undefined);
	const kept = existing ? splitPem(existing) : undefined;
	if (kept && stillGood(authority, kept, names, now)) {
		return { ...kept, issued: false };
	}

	const issued = issueLocalCertificate(authority, names, { now });
	await mkdir(dirname(file), { recursive: true, mode: 0o700 });
	const staging = `${file}.${process.pid}.${randomBytes(4).toString('hex')}`;
	await writeFile(staging, `${issued.cert}${issued.key}`, { mode: 0o600 });
	await rename(staging, file);
	return { ...issued, issued: true };
}

/** A combined PEM file's certificate and key. */
function splitPem(pem: string): LocalCertificate | undefined {
	const cert = pem.match(
		/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\r?\n?/,
	)?.[0];
	const key = pem.match(
		/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----\r?\n?/,
	)?.[0];
	return cert && key ? { cert, key } : undefined;
}

/** Whether a kept certificate still serves: the authority's, every name, in date. */
function stillGood(
	authority: LocalAuthority,
	kept: LocalCertificate,
	names: readonly string[],
	now: Date,
): boolean {
	try {
		const root = forge.pki.certificateFromPem(authority.cert);
		const cert = forge.pki.certificateFromPem(kept.cert);
		if (!root.verify(cert)) return false;
		if (
			cert.validity.notAfter.getTime() - now.getTime() <
			RENEW_WITHIN_DAYS * DAY
		) {
			return false;
		}
		// The key is the certificate's: a half-written pair is issued again.
		const certKey = createPublicKey(kept.cert).export({
			type: 'spki',
			format: 'der',
		});
		const ownKey = createPublicKey(createPrivateKey(kept.key)).export({
			type: 'spki',
			format: 'der',
		});
		if (!certKey.equals(ownKey)) return false;
		const san = cert.getExtension('subjectAltName') as
			| { altNames?: { type: number; value: string }[] }
			| undefined;
		const dns = new Set(
			(san?.altNames ?? []).filter((n) => n.type === 2).map((n) => n.value),
		);
		return names.every((name) => dns.has(name));
	} catch {
		return false;
	}
}

/** An RSA key pair, made natively — forge's own generation is slow. */
function keyPair(): {
	privateKey: forge.pki.rsa.PrivateKey;
	publicKey: forge.pki.rsa.PublicKey;
} {
	const { privateKey: pem } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});
	const privateKey = forge.pki.privateKeyFromPem(
		pem,
	) as forge.pki.rsa.PrivateKey;
	return {
		privateKey,
		publicKey: forge.pki.setRsaPublicKey(privateKey.n, privateKey.e),
	};
}

/**
 * Attributes as UTF8String. forge writes PrintableString otherwise, which
 * has no `@` or `*` — and a TLS stack rejects the certificate outright.
 */
function utf8(
	attributes: { name: string; value: string }[],
): forge.pki.CertificateField[] {
	return attributes.map((attribute) => ({
		...attribute,
		valueTagClass: forge.asn1.Type.UTF8 as never,
	}));
}

/** A random, positive serial: sixteen bytes, its high bit clear. */
function serialNumber(): string {
	const bytes = randomBytes(16);
	bytes[0] = bytes[0]! & 0x7f;
	return bytes.toString('hex');
}

/** `user@host`, as far as the machine will say. */
function owner(): string {
	let user = 'gkm';
	try {
		user = userInfo().username;
	} catch {
		// No passwd entry — a container's arbitrary uid.
	}
	return `${user}@${hostname()}`;
}
