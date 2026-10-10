import { describe, expect } from 'vitest';
import { z } from 'zod/v4';
import { RestApi } from '../../rest-api';
import { featureTest } from '../featureTest';
import type { TestManifest } from '../manifest';

/**
 * A feature test posts an HTML form the way a browser does, and sees the
 * redirect it is answered with — or follows it, as a browser would.
 */

const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });

const signIn = api
	.post('/sign-in')
	.body(z.object({ email: z.email(), password: z.string() }))
	.output(z.string())
	.responseType('text/html')
	.handle(async ({ body }, response) => {
		if (body.password !== 'hunter2') return '<p>Wrong password</p>';
		return response
			.cookie('session', body.email, { path: '/' })
			.redirect('/home');
	});

const home = api
	.get('/home')
	.output(z.string())
	.responseType('text/html')
	.handle(async ({ cookie }) => `<p>Hello ${cookie('session')}</p>`);

const manifest: TestManifest = {
	stage: 'test',
	constructs: {},
	endpoints: [
		{ surface: 'Api', source: { file: 'endpoints', export: 'signIn' } },
		{ surface: 'Api', source: { file: 'endpoints', export: 'home' } },
	],
	env: { API_URL: 'http://api.forms.test' },
};

const it = featureTest({ manifest, modules: { endpoints: { signIn, home } } });

const form = (fields: Record<string, string>): RequestInit => ({
	method: 'POST',
	headers: { 'content-type': 'application/x-www-form-urlencoded' },
	body: new URLSearchParams(fields).toString(),
});

describe('a form post in a feature test', () => {
	it('sees the redirect: its status and Location', async ({ browser }) => {
		const response = await browser.fetch('http://api.forms.test/sign-in', {
			...form({ email: 'ada@example.com', password: 'hunter2' }),
			redirect: 'manual',
		});

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/home');
	});

	it('follows the redirect with the cookie it set', async ({ browser }) => {
		const response = await browser.fetch(
			'http://api.forms.test/sign-in',
			form({ email: 'ada@example.com', password: 'hunter2' }),
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('<p>Hello ada@example.com</p>');
	});

	it('renders the page when the form is wrong', async ({ browser }) => {
		const response = await browser.fetch(
			'http://api.forms.test/sign-in',
			form({ email: 'ada@example.com', password: 'nope' }),
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('<p>Wrong password</p>');
	});
});
