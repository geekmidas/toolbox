import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EAS_GRAPHQL, EasApiError, ExpoTokenMissing, easApi } from '../easApi';

/** EAS's GraphQL API when it will not answer, through MSW. */

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe('EAS, refusing', () => {
	it('asks for EXPO_TOKEN before calling anything', async () => {
		await expect(easApi('').project('p')).rejects.toBeInstanceOf(
			ExpoTokenMissing,
		);
	});

	it.for([
		[
			'its GraphQL errors, joined',
			() =>
				HttpResponse.json({
					errors: [{ message: 'Not authorized' }, { message: 'Try again' }],
				}),
			'Not authorized; Try again',
		],
		[
			'the HTTP status when the body is not JSON',
			() => new HttpResponse('<html>bad gateway</html>', { status: 502 }),
			'HTTP 502',
		],
		[
			'the HTTP status when there is no data',
			() => HttpResponse.json({}),
			'HTTP 200',
		],
	] as const)('names the operation, with %s', async ([, answer, detail]) => {
		server.use(http.post(EAS_GRAPHQL, answer));

		const refused = easApi('expo-token').deleteKey('key-1');

		await expect(refused).rejects.toBeInstanceOf(EasApiError);
		await expect(refused).rejects.toMatchObject({ detail });
	});
});
