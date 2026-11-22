/**
 * The origin certificate a CDN issues for the hosts it answers — what the
 * server shows the CDN when it connects (`deploy.cdn.<stage>.certificate`,
 * `'origin'` by default).
 *
 * A host behind Cloudflare's proxy resolves to Cloudflare, so Let's
 * Encrypt's HTTP challenge no longer reliably reaches the server. Cloudflare
 * issues certificates for its own origins instead: trusted by its proxy and
 * by nothing else, valid up to 15 years, for whatever hosts the request
 * names. So the deploy:
 *
 * - **makes the key here**, on the machine that runs the deploy, and sends
 *   Cloudflare's Origin CA only a signing request — the key is never sent;
 * - **asks for exactly the hosts the CDN answers**, never a wildcard it did
 *   not declare: the edge is shared, and a certificate is served for every
 *   name it covers;
 * - **keeps both in the stage's secrets**, under keys gkm reserves for the
 *   server (`GKM_SERVER_*`, never handed to an app), so every later deploy
 *   reuses them — and the server holds no Cloudflare token;
 * - **asks again** only when the hosts it is for change, its key no longer
 *   matches, or it is within {@link ORIGIN_RENEW_BEFORE_DAYS} of expiring.
 *
 * The token is the deploy's own (`CLOUDFLARE_API_TOKEN`), which then needs
 * `Zone → SSL and Certificates → Edit` beside its DNS permissions.
 */

import {
	createPrivateKey,
	generateKeyPairSync,
	X509Certificate,
} from 'node:crypto';
import forge from 'node-forge';
import {
	type CredentialProvider,
	MissingCredential,
} from '../deploy/credentials';

/** The stage secret holding the origin certificate, PEM. */
export const ORIGIN_CERT_KEY = 'GKM_SERVER_ORIGIN_CERT';

/** The stage secret holding its private key, PEM. */
export const ORIGIN_KEY_KEY = 'GKM_SERVER_ORIGIN_KEY';

/** What is asked for: the Origin CA's longest, 15 years. */
export const ORIGIN_VALIDITY_DAYS = 5475;

/** How close to its expiry a kept certificate is replaced. */
export const ORIGIN_RENEW_BEFORE_DAYS = 30;

/** A certificate and its key, PEM. */
export interface OriginCertificate {
	cert: string;
	key: string;
}

/** Why a kept certificate is not served — for the line that says so. */
export type OriginCertificateProblem =
	| 'missing'
	| 'unreadable'
	| 'key'
	| 'hosts'
	| 'expiring';

/** The names a certificate covers, lowercase: its DNS subject alternative names. */
function certificateHosts(cert: X509Certificate): Set<string> {
	return new Set(
		(cert.subjectAltName ?? '')
			.split(',')
			.map((entry) => entry.trim())
			.filter((entry) => entry.startsWith('DNS:'))
			.map((entry) => entry.slice(4).toLowerCase()),
	);
}

/**
 * What is wrong with a kept certificate for `hosts` at `now`, or `undefined`
 * when it serves them: it covers each by name, its key is its own, and it
 * is not about to expire.
 */
export function originCertificateProblem(
	kept: Partial<OriginCertificate> | undefined,
	hosts: readonly string[],
	now: Date = new Date(),
): OriginCertificateProblem | undefined {
	if (!kept?.cert || !kept.key) return 'missing';
	let cert: X509Certificate;
	try {
		cert = new X509Certificate(kept.cert);
		if (!cert.checkPrivateKey(createPrivateKey(kept.key))) return 'key';
	} catch {
		return 'unreadable';
	}
	const covered = certificateHosts(cert);
	if (!hosts.every((host) => covered.has(host.toLowerCase()))) return 'hosts';
	const renewAt =
		new Date(cert.validTo).getTime() -
		ORIGIN_RENEW_BEFORE_DAYS * 24 * 60 * 60 * 1000;
	if (now.getTime() >= renewAt) return 'expiring';
	return undefined;
}

/**
 * A new private key and a signing request for `hosts` — RSA, which every
 * proxy serves. The key stays here; only the request is sent.
 */
export function originSigningRequest(hosts: readonly string[]): {
	csr: string;
	key: string;
} {
	const { privateKey, publicKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
	});
	const key = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
	const csr = forge.pki.createCertificationRequest();
	csr.publicKey = forge.pki.publicKeyFromPem(
		publicKey.export({ type: 'spki', format: 'pem' }).toString(),
	);
	csr.setSubject([{ name: 'commonName', value: hosts[0]! }]);
	csr.setAttributes([
		{
			name: 'extensionRequest',
			extensions: [
				{
					name: 'subjectAltName',
					altNames: hosts.map((value) => ({ type: 2, value })),
				},
			],
		},
	]);
	csr.sign(forge.pki.privateKeyFromPem(key), forge.md.sha256.create());
	return { csr: forge.pki.certificationRequestToPem(csr), key };
}

/** What issuing an origin certificate asks of Cloudflare. */
export interface OriginCertificateIssuer {
	createOriginCertificate(
		zone: string,
		request: {
			csr: string;
			hostnames: readonly string[];
			days: number;
			type: 'origin-rsa';
		},
	): Promise<{ certificate: string }>;
}

export interface EnsureOriginCertificateInput {
	stage: string;
	/** The Cloudflare zone the hosts are in. */
	zone: string;
	/** The hosts the CDN answers — exactly what is asked for. */
	hosts: readonly string[];
	/** The stage's secrets as they are now. */
	custom: Readonly<Record<string, string>> | undefined;
	/** Where the deploy's Cloudflare token comes from. */
	credentials: CredentialProvider;
	/** Keeps a new certificate in the stage's secrets, the moment it exists. */
	keep(values: Record<string, string>): Promise<void>;
	dryRun?: boolean;
	log?: (line: string) => void;
	now?: Date;
	/** Cloudflare's API, for tests; the real one by default. */
	issuer?: (token: string) => Promise<OriginCertificateIssuer>;
}

const REASONS: Record<OriginCertificateProblem, string> = {
	missing: 'there is none yet',
	unreadable: 'the one kept cannot be read',
	key: 'the one kept does not match its key',
	hosts: 'the hosts it is for changed',
	expiring: `the one kept expires within ${ORIGIN_RENEW_BEFORE_DAYS} days`,
};

/**
 * The stage's origin certificate for `hosts`: the one kept, while it serves
 * them, and otherwise a new one from Cloudflare's Origin CA, kept before it
 * is returned. A dry run issues nothing, and says it would.
 *
 * @throws {MissingCredential} when one must be issued and there is no token
 */
export async function ensureOriginCertificate(
	input: EnsureOriginCertificateInput,
): Promise<OriginCertificate | undefined> {
	const log = input.log ?? ((line: string) => console.log(line));
	const hosts = [...new Set(input.hosts.map((h) => h.toLowerCase()))].sort();
	const kept = {
		cert: input.custom?.[ORIGIN_CERT_KEY],
		key: input.custom?.[ORIGIN_KEY_KEY],
	};
	const problem = originCertificateProblem(kept, hosts, input.now);
	if (!problem) return kept as OriginCertificate;

	const why = REASONS[problem];
	if (input.dryRun) {
		log(
			`   🔐 would have Cloudflare issue an origin certificate for ${hosts.join(', ')} — ${why}`,
		);
		return problem === 'expiring' || problem === 'hosts'
			? (kept as OriginCertificate)
			: undefined;
	}

	const credential = await input.credentials.get({ kind: 'cloudflare' });
	if (!credential?.token) {
		throw new MissingCredential(
			'cloudflare',
			`${input.stage}'s origin certificate`,
		);
	}
	log(
		`   🔐 Cloudflare issues an origin certificate for ${hosts.join(', ')} — ${why}`,
	);
	const issuer = await (input.issuer ?? cloudflareIssuer)(credential.token);
	const { csr, key } = originSigningRequest(hosts);
	const { certificate } = await issuer.createOriginCertificate(input.zone, {
		csr,
		hostnames: hosts,
		days: ORIGIN_VALIDITY_DAYS,
		type: 'origin-rsa',
	});
	const issued = { cert: certificate, key };
	await input.keep({ [ORIGIN_CERT_KEY]: issued.cert, [ORIGIN_KEY_KEY]: key });
	return issued;
}

/** Cloudflare's own Origin CA, through the deploy's token. */
async function cloudflareIssuer(
	token: string,
): Promise<OriginCertificateIssuer> {
	const { CloudflareApi } = await import('@geekmidas/edge/dns/cloudflare');
	return new CloudflareApi({ credential: { token } });
}
