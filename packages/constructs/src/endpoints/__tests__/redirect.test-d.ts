import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { RestApi } from '../../rest-api';
import {
	type EndpointStatus,
	RedirectStatus,
	type ResponseBuilder,
	type ResponseWithMetadata,
} from '../Endpoint';

const api = new RestApi('Test', { path: '.', defaultAuthorizer: 'none' });

describe('redirects', () => {
	it('response.redirect() is a response any output schema accepts', () => {
		api
			.post('/sign-in')
			.body(z.object({ password: z.string() }))
			.output(z.object({ id: z.string() }))
			.handle(async (_ctx, response) => response.redirect('/ios'));

		api
			.get('/page')
			.output(z.string())
			.responseType('text/html')
			.handle(async (_ctx, response) =>
				Math.random() > 0.5 ? response.redirect('/ios', 302) : '<p>hi</p>',
			);
	});

	it('response.redirect() takes a redirect status only', () => {
		expectTypeOf<ResponseBuilder['redirect']>()
			.parameter(1)
			.toEqualTypeOf<RedirectStatus | undefined>();
		expectTypeOf<ReturnType<ResponseBuilder['redirect']>>().toEqualTypeOf<
			ResponseWithMetadata<never>
		>();

		api.get('/x').handle(async (_ctx, response) =>
			// @ts-expect-error a 200 is not a redirect
			response.redirect('/ios', 200),
		);
	});

	it('status() takes a 2xx or a 3xx', () => {
		api
			.get('/x')
			.handle(async (_ctx, response) =>
				response.status(303).header('location', '/ios').send(null),
			);
		api
			.post('/y')
			.status(RedirectStatus.SeeOther)
			.handle(async () => null);
		api
			.post('/z')
			.status(201)
			.handle(async () => null);

		expectTypeOf<303>().toExtend<EndpointStatus>();
		// @ts-expect-error a 404 is not a status a handler succeeds with
		api.post('/w').status(404);
	});
});
