import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { ensureIdentity } from '../ses/email';
import { sesClients } from '../ses/index';

/**
 * An identity's DKIM as the deploy finds it. The emulator never verifies a
 * domain, so a verified one — by DKIM, or only by its TXT record — is SES's
 * own answer, served here.
 */

const REGION = 'eu-west-1';
const DOMAIN = 'sendwell.example';
const ENDPOINT = `https://email.${REGION}.amazonaws.com`;

const server = setupServer();
beforeAll(() => {
	// SES itself, not the emulator a shell may point the SDK at.
	vi.stubEnv('AWS_ENDPOINT_URL', undefined);
	vi.stubEnv('AWS_ENDPOINT_URL_SES', undefined);
	server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => server.resetHandlers());
afterAll(() => {
	server.close();
	vi.unstubAllEnvs();
});

const xml = (action: string, result = '') =>
	HttpResponse.text(
		`<${action}Response xmlns="http://ses.amazonaws.com/doc/2010-12-01/">` +
			`<${action}Result>${result}</${action}Result>` +
			`<ResponseMetadata><RequestId>r</RequestId></ResponseMetadata>` +
			`</${action}Response>`,
		{ headers: { 'content-type': 'text/xml' } },
	);

/** SES with the domain's DKIM in `status`; every action asked is recorded. */
function ses(status: string, enabled: boolean) {
	const asked: string[] = [];
	server.use(
		http.post(`${ENDPOINT}/`, async ({ request }) => {
			const action = new URLSearchParams(await request.text()).get('Action')!;
			asked.push(action);
			if (action === 'GetIdentityDkimAttributes') {
				return xml(
					action,
					`<DkimAttributes><entry><key>${DOMAIN}</key><value>` +
						`<DkimEnabled>${enabled}</DkimEnabled>` +
						`<DkimVerificationStatus>${status}</DkimVerificationStatus>` +
						'<DkimTokens/></value></entry></DkimAttributes>',
				);
			}
			if (action === 'VerifyDomainDkim') {
				return xml(
					action,
					'<DkimTokens><member>t1</member><member>t2</member>' +
						'<member>t3</member></DkimTokens>',
				);
			}
			return xml(action);
		}),
	);
	return asked;
}

async function ensure() {
	const changes: string[] = [];
	const dns: { host: string; value: string }[] = [];
	const ctx = {
		change: async (c: { change: string }, run: () => Promise<unknown>) => {
			changes.push(c.change);
			await run();
		},
		writeDns: async (records: { host: string; value: string }[]) => {
			dns.push(...records);
		},
		log: () => {},
	};
	const clients = await sesClients(
		{ accessKeyId: 'AKIATEST', secretAccessKey: 'secret', region: REGION },
		REGION,
	);
	try {
		await ensureIdentity(ctx as never, clients, DOMAIN);
	} finally {
		clients.ses.destroy();
	}
	return { changes, dns };
}

describe("the sending domain's DKIM", () => {
	it('leaves a domain whose DKIM is verified and signing as it is', async () => {
		const asked = ses('Success', true);

		const { changes, dns } = await ensure();

		expect(asked).toEqual(['GetIdentityDkimAttributes']);
		expect(changes).toEqual([]);
		expect(dns).toEqual([]);
	});

	it('turns signing back on for a verified domain that had it off', async () => {
		const asked = ses('Success', false);

		const { changes, dns } = await ensure();

		expect(asked).toEqual([
			'GetIdentityDkimAttributes',
			'SetIdentityDkimEnabled',
		]);
		expect(changes).toEqual(['turn DKIM signing back on']);
		expect(dns).toEqual([]);
	});

	it('gives DKIM to a domain verified only by its TXT record, which would send unsigned', async () => {
		const asked = ses('NotStarted', false);

		const { changes, dns } = await ensure();

		expect(asked).toEqual(['GetIdentityDkimAttributes', 'VerifyDomainDkim']);
		expect(changes).toEqual(['verify with DKIM']);
		expect(dns).toEqual(
			['t1', 't2', 't3'].map((t) =>
				expect.objectContaining({
					host: `${t}._domainkey.${DOMAIN}`,
					value: `${t}.dkim.amazonses.com`,
				}),
			),
		);
	});
});
