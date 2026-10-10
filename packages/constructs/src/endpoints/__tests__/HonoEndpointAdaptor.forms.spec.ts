import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery } from '@geekmidas/services';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RestApi } from '../../rest-api';
import { HonoEndpoint } from '../HonoEndpointAdaptor';

/**
 * A server-rendered site posts HTML forms and answers them with a redirect:
 * the body is read by its Content-Type into the same `.body()` schema JSON
 * is, and `response.redirect()` sends a 303 the output schema does not check.
 */

const api = new RestApi('Site', { path: '.', defaultAuthorizer: 'none' });

const login = api
	.post('/login')
	.body(z.object({ email: z.email(), password: z.string() }))
	.output(z.string())
	.responseType('text/html')
	.handle(async ({ body }) => `<p>${body.email} / ${body.password}</p>`);

const tags = api
	.post('/tags')
	.body(
		z.object({
			tag: z.array(z.string()),
			'only[]': z.array(z.string()),
			name: z.string(),
		}),
	)
	.output(z.object({ tag: z.array(z.string()), only: z.array(z.string()) }))
	.handle(async ({ body }) => ({ tag: body.tag, only: body['only[]'] }));

const upload = api
	.post('/upload')
	.body(z.object({ title: z.string(), file: z.instanceof(File) }))
	.output(z.object({ title: z.string(), name: z.string(), size: z.number() }))
	.handle(async ({ body }) => ({
		title: body.title,
		name: body.file.name,
		size: body.file.size,
	}));

const note = api
	.post('/note')
	.body(z.string())
	.output(z.object({ note: z.string() }))
	.handle(async ({ body }) => ({ note: body }));

const signIn = api
	.post('/sign-in')
	.body(z.object({ password: z.string() }))
	.output(z.string())
	.responseType('text/html')
	.handle(async ({ body }, response) => {
		if (body.password !== 'hunter2') return '<p>Wrong password</p>';
		return response
			.cookie('session', 'abc', { httpOnly: true, path: '/' })
			.redirect('/ios');
	});

const moved = api
	.get('/old')
	.output(z.object({ id: z.string() }))
	.handle(async (_, response) => response.redirect('/new', 308));

const alwaysAway = api
	.post('/away')
	.status(302)
	.output(z.object({ id: z.string() }))
	.handle(async (_, response) =>
		response.header('location', '/elsewhere').send({} as { id: string }),
	);

function app() {
	const hono = new Hono();
	HonoEndpoint.addRoutes(
		[login, tags, upload, note, signIn, moved, alwaysAway] as any,
		ServiceDiscovery.getInstance(new EnvironmentParser({})),
		hono,
		{ docsPath: false },
	);
	return hono;
}

const post = (path: string, init: RequestInit) =>
	app().request(path, { method: 'POST', ...init });

describe('HonoEndpoint — form bodies', () => {
	it('validates an application/x-www-form-urlencoded post into the body schema', async () => {
		const response = await post('/login', {
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				email: 'ada@example.com',
				password: 'hunter2',
			}).toString(),
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('<p>ada@example.com / hunter2</p>');
	});

	it('validates a multipart/form-data post into the body schema', async () => {
		const form = new FormData();
		form.append('email', 'ada@example.com');
		form.append('password', 'hunter2');

		const response = await post('/login', { body: form });

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('<p>ada@example.com / hunter2</p>');
	});

	it('hands a multipart file part to the schema as a File', async () => {
		const form = new FormData();
		form.append('title', 'Avatar');
		form.append('file', new File(['12345'], 'avatar.png'));

		const response = await post('/upload', { body: form });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			title: 'Avatar',
			name: 'avatar.png',
			size: 5,
		});
	});

	it('reads a repeated field, and one named field[], as an array', async () => {
		const response = await post('/tags', {
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: 'tag=a&tag=b&only[]=x&name=n',
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ tag: ['a', 'b'], only: ['x'] });
	});

	it('answers a form that fails the schema with the same 422 as JSON', async () => {
		const response = await post('/login', {
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: 'email=ada@example.com',
		});

		expect(response.status).toBe(422);
		const issues = (await response.json()) as { path: string[] }[];
		expect(issues.map((issue) => issue.path)).toEqual([['password']]);
	});

	it('reads JSON as before', async () => {
		const response = await post('/login', {
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'ada@example.com', password: 'hunter2' }),
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('<p>ada@example.com / hunter2</p>');
	});

	it('reads a text body as its text', async () => {
		const response = await post('/note', {
			headers: { 'content-type': 'text/plain; charset=utf-8' },
			body: 'remember the milk',
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ note: 'remember the milk' });
	});

	it('answers a content type it cannot read with a 415', async () => {
		const response = await post('/login', {
			headers: { 'content-type': 'application/xml' },
			body: '<login/>',
		});

		expect(response.status).toBe(415);
		expect(await response.json()).toMatchObject({
			name: 'UnsupportedRequestContentType',
			statusCode: 415,
			statusMessage: 'Unsupported Media Type',
			details: { contentType: 'application/xml' },
		});
	});

	it('answers a body with no content type with the same 422 as before', async () => {
		// Bytes: a string body would be sent as text/plain.
		const request = new Request('http://localhost/login', {
			method: 'POST',
			body: new TextEncoder().encode('email=a&password=b'),
		});
		expect(request.headers.get('content-type')).toBeNull();

		const response = await app().request(request);

		expect(response.status).toBe(422);
	});

	it('answers malformed JSON with a 400', async () => {
		const response = await post('/login', {
			headers: { 'content-type': 'application/json' },
			body: '{"email":',
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			name: 'MalformedRequestBody',
		});
	});
});

describe('HonoEndpoint — redirects', () => {
	it('answers response.redirect() with a 303, Location and no body', async () => {
		const response = await post('/sign-in', {
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: 'password=hunter2',
		});

		expect(response.status).toBe(303);
		expect(response.headers.get('location')).toBe('/ios');
		expect(response.headers.get('set-cookie')).toContain('session=abc');
		expect(await response.text()).toBe('');
	});

	it('still renders the page when the handler does not redirect', async () => {
		const response = await post('/sign-in', {
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: 'password=nope',
		});

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('<p>Wrong password</p>');
	});

	it('does not check a redirect against the output schema', async () => {
		const response = await app().request('/old');

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe('/new');
	});

	it('treats an endpoint whose status is a 3xx as a redirect', async () => {
		const response = await post('/away', {});

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/elsewhere');
		expect(await response.text()).toBe('');
	});
});
