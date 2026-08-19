import { EnvironmentParser } from '@geekmidas/envkit';
import type { EmailClient } from '@geekmidas/emailkit';
import { describe, expect, it } from 'vitest';
import { Email } from '../email';
import { snifferContext } from '../Construct';

/** A template record — the only structural option the construct takes. */
const templates = {
	welcome: ({ name }: { name: string }) => ({ type: 'p', props: { children: name } }) as any,
};

/** Register the construct's service against a fixed environment. */
const connect = (env: Record<string, string>, construct = new Email('Mail', { templates })) =>
	construct.service.register({
		envParser: new EnvironmentParser(env) as any,
		context: snifferContext,
	}) as Promise<EmailClient<typeof templates>>;

describe('Email', () => {
	it('canonicalises its id', () => {
		// `transactional-mail` and `TransactionalMail` are one construct.
		expect(new Email('transactional-mail', { templates }).id).toBe(
			'TransactionalMail',
		);
	});

	it('declares one email node', () => {
		expect(new Email('Mail', { templates }).declare()).toEqual([
			{ kind: 'email', id: 'Mail', provides: ['MAIL_URL', 'MAIL_FROM'] },
		]);
	});

	it('declares nothing about who delivers the mail', () => {
		// No provider, no region, no domain — all of those differ between dev and
		// prod, so they arrive as stage config rather than in the manifest.
		const [declaration] = new Email('Mail', { templates }).declare();

		expect(Object.keys(declaration).sort()).toEqual([
			'id',
			'kind',
			'provides',
		]);
	});

	it('is consumed under the uncapitalised form of its id', () => {
		expect(new Email('Mail', { templates }).service.serviceName).toBe('mail');
	});

	it('reads the same keys it declared', async () => {
		// The point of holding the keys once: what the build publishes and what
		// the client reads cannot drift.
		const construct = new Email('Mail', { templates });
		const [declaration] = construct.declare();

		await expect(
			connect(
				Object.fromEntries(
					declaration.provides!.map((key) => [
						key,
						key.endsWith('_URL') ? 'smtp://mailpit:1025' : 'noreply@myapp.test',
					]),
				),
				construct,
			),
		).resolves.toBeDefined();
	});

	it('builds a client against the local container', async () => {
		const client = await connect({
			MAIL_URL: 'smtp://mailpit:1025',
			MAIL_FROM: 'noreply@myapp.test',
		});

		expect(client).toBeDefined();
		await client.close();
	});

	it('builds the same client against a deployed provider', async () => {
		// Identical construct, identical call — only the injected URL differs,
		// which is what the single smtp:// scheme buys.
		const client = await connect({
			MAIL_URL:
				'smtps://AKIAEXAMPLE:secret@email-smtp.eu-west-1.amazonaws.com:465',
			MAIL_FROM: 'noreply@example.com',
		});

		expect(client).toBeDefined();
		await client.close();
	});

	it('fails when the URL names a provider as its scheme', async () => {
		await expect(
			connect({ MAIL_URL: 'ses://?region=eu-west-1', MAIL_FROM: 'a@b.test' }),
		).rejects.toThrow();
	});
});
