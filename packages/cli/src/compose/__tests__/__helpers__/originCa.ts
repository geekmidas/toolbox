/**
 * An Origin CA stand-in: signs each certificate request it is sent, for the
 * names it is asked for, with a CA of its own — so what a test keeps and
 * checks is a real certificate for a real key.
 */

import forge from 'node-forge';
import type { OriginCertificateIssuer } from '../../originCertificate';

let ca:
	| { key: forge.pki.rsa.PrivateKey; cert: forge.pki.Certificate }
	| undefined;

/** The CA, made once per test file: RSA key generation takes a moment. */
function authority() {
	if (ca) return ca;
	const keys = forge.pki.rsa.generateKeyPair(2048);
	const cert = forge.pki.createCertificate();
	cert.publicKey = keys.publicKey;
	cert.serialNumber = '01';
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date(Date.now() + 20 * 365 * 86_400_000);
	const name = [{ name: 'commonName', value: 'Test Origin CA' }];
	cert.setSubject(name);
	cert.setIssuer(name);
	cert.sign(keys.privateKey, forge.md.sha256.create());
	ca = { key: keys.privateKey, cert };
	return ca;
}

/** An Origin CA, and what it was asked. */
export function originCa() {
	const asked: { zone: string; hostnames: readonly string[]; days: number }[] =
		[];
	const csrs: string[] = [];
	const issuer: OriginCertificateIssuer = {
		async createOriginCertificate(zone, request) {
			const { key, cert: root } = authority();
			asked.push({ zone, hostnames: request.hostnames, days: request.days });
			csrs.push(request.csr);
			const csr = forge.pki.certificationRequestFromPem(request.csr);
			const cert = forge.pki.createCertificate();
			cert.publicKey = csr.publicKey!;
			cert.serialNumber = String(asked.length + 1).padStart(2, '0');
			cert.validity.notBefore = new Date();
			cert.validity.notAfter = new Date(Date.now() + request.days * 86_400_000);
			cert.setSubject(csr.subject.attributes);
			cert.setIssuer(root.subject.attributes);
			cert.setExtensions([
				{
					name: 'subjectAltName',
					altNames: request.hostnames.map((value) => ({ type: 2, value })),
				},
			]);
			cert.sign(key, forge.md.sha256.create());
			return { certificate: forge.pki.certificateToPem(cert) };
		},
	};
	return { issuer: async () => issuer, asked, csrs };
}
