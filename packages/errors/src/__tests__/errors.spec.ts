import { describe, expect, it } from 'vitest';
import {
	BadGatewayError,
	BadRequestError,
	ConflictError,
	createError,
	createHttpError,
	ForbiddenError,
	GatewayTimeoutError,
	HttpError,
	HttpStatusCode,
	InternalServerError,
	isClientError,
	isHttpError,
	isServerError,
	MethodNotAllowedError,
	NotFoundError,
	NotImplementedError,
	ServiceUnavailableError,
	TooManyRequestsError,
	UnauthorizedError,
	UnprocessableEntityError,
	wrapError,
} from '../index';

describe('HttpError', () => {
	it('should create basic HTTP error', () => {
		const error = new HttpError(400, 'Bad request');

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(HttpError);
		expect(error.statusCode).toBe(400);
		expect(error.statusMessage).toBe('Bad Request');
		expect(error.message).toBe('Bad request');
		expect(error.name).toBe('HttpError');
		expect(error.isHttpError).toBe(true);
	});

	it('should use default status message when not provided', () => {
		const error = new HttpError(404);

		expect(error.statusMessage).toBe('Not Found');
		expect(error.message).toBe('HTTP Error'); // Default from constructor
	});

	it('should include error details', () => {
		const error = new HttpError(400, 'Invalid input', {
			details: { field: 'email', value: 'invalid' },
		});

		expect(error.details).toEqual({ field: 'email', value: 'invalid' });
	});

	it('should include error code', () => {
		const error = new HttpError(400, 'Invalid input', {
			code: 'VALIDATION_ERROR',
		});

		expect(error.code).toBe('VALIDATION_ERROR');
	});

	it('should support error cause chaining', () => {
		const originalError = new Error('Database connection failed');
		const error = new HttpError(500, 'Internal error', {
			cause: originalError,
		});

		expect(error.cause).toBe(originalError);
	});

	it('should serialize to JSON', () => {
		const error = new HttpError(404, 'Not found', {
			details: { id: '123' },
			code: 'NOT_FOUND',
		});

		const json = error.toJSON();

		expect(json).toMatchObject({
			name: 'HttpError',
			message: 'Not found',
			statusCode: 404,
			statusMessage: 'Not Found',
			code: 'NOT_FOUND',
			details: { id: '123' },
		});
		expect(json.stack).toBeDefined();
	});

	it('should generate error body', () => {
		const error = new HttpError(400, 'Bad request', {
			details: { field: 'email' },
			code: 'INVALID_EMAIL',
		});

		const body = JSON.parse(error.body);

		expect(body).toEqual({
			message: 'Bad request',
			code: 'INVALID_EMAIL',
			error: { field: 'email' },
		});
	});

	it('should handle unknown status codes', () => {
		const error = new HttpError(418);

		expect(error.statusCode).toBe(418);
		expect(error.statusMessage).toBe('Unknown Error');
	});
});

describe('Client Error Classes (4xx)', () => {
	describe('BadRequestError', () => {
		it('should create 400 error', () => {
			const error = new BadRequestError('Invalid input');

			expect(error.statusCode).toBe(400);
			expect(error.statusMessage).toBe('Bad Request');
			expect(error.message).toBe('Invalid input');
		});

		it('should include details', () => {
			const error = new BadRequestError('Invalid input', { field: 'email' });

			expect(error.details).toEqual({ field: 'email' });
		});
	});

	describe('UnauthorizedError', () => {
		it('should create 401 error', () => {
			const error = new UnauthorizedError('Invalid token');

			expect(error.statusCode).toBe(401);
			expect(error.statusMessage).toBe('Unauthorized');
			expect(error.message).toBe('Invalid token');
		});
	});

	describe('ForbiddenError', () => {
		it('should create 403 error', () => {
			const error = new ForbiddenError('Access denied');

			expect(error.statusCode).toBe(403);
			expect(error.statusMessage).toBe('Forbidden');
			expect(error.message).toBe('Access denied');
		});
	});

	describe('NotFoundError', () => {
		it('should create 404 error', () => {
			const error = new NotFoundError('User not found');

			expect(error.statusCode).toBe(404);
			expect(error.statusMessage).toBe('Not Found');
			expect(error.message).toBe('User not found');
		});
	});

	describe('MethodNotAllowedError', () => {
		it('should create 405 error', () => {
			const error = new MethodNotAllowedError('DELETE not allowed');

			expect(error.statusCode).toBe(405);
			expect(error.statusMessage).toBe('Method Not Allowed');
			expect(error.message).toBe('DELETE not allowed');
		});

		it('should include allowed methods', () => {
			const error = new MethodNotAllowedError('DELETE not allowed', [
				'GET',
				'POST',
				'PUT',
			]);

			expect(error.details).toEqual({
				allowedMethods: ['GET', 'POST', 'PUT'],
			});
		});
	});

	describe('ConflictError', () => {
		it('should create 409 error', () => {
			const error = new ConflictError('Email already exists');

			expect(error.statusCode).toBe(409);
			expect(error.statusMessage).toBe('Conflict');
			expect(error.message).toBe('Email already exists');
		});
	});

	describe('UnprocessableEntityError', () => {
		it('should create 422 error', () => {
			const error = new UnprocessableEntityError('Validation failed');

			expect(error.statusCode).toBe(422);
			expect(error.statusMessage).toBe('Unprocessable Entity');
			expect(error.message).toBe('Validation failed');
		});

		it('should include validation errors', () => {
			const error = new UnprocessableEntityError('Validation failed', {
				email: 'Invalid format',
				age: 'Must be 18+',
			});

			expect(error.details).toEqual({
				validationErrors: {
					email: 'Invalid format',
					age: 'Must be 18+',
				},
			});
		});
	});

	describe('TooManyRequestsError', () => {
		it('should create 429 error', () => {
			const error = new TooManyRequestsError('Rate limit exceeded');

			expect(error.statusCode).toBe(429);
			expect(error.statusMessage).toBe('Too Many Requests');
			expect(error.message).toBe('Rate limit exceeded');
		});

		it('should include retry after', () => {
			const error = new TooManyRequestsError('Rate limit exceeded', 60);

			expect(error.details).toEqual({ retryAfter: 60 });
		});
	});
});

describe('Server Error Classes (5xx)', () => {
	describe('InternalServerError', () => {
		it('should create 500 error', () => {
			const error = new InternalServerError('Database error');

			expect(error.statusCode).toBe(500);
			expect(error.statusMessage).toBe('Internal Server Error');
			expect(error.message).toBe('Database error');
		});
	});

	describe('NotImplementedError', () => {
		it('should create 501 error', () => {
			const error = new NotImplementedError('Feature not implemented');

			expect(error.statusCode).toBe(501);
			expect(error.statusMessage).toBe('Not Implemented');
			expect(error.message).toBe('Feature not implemented');
		});
	});

	describe('BadGatewayError', () => {
		it('should create 502 error', () => {
			const error = new BadGatewayError('Upstream error');

			expect(error.statusCode).toBe(502);
			expect(error.statusMessage).toBe('Bad Gateway');
			expect(error.message).toBe('Upstream error');
		});
	});

	describe('ServiceUnavailableError', () => {
		it('should create 503 error', () => {
			const error = new ServiceUnavailableError('Service down');

			expect(error.statusCode).toBe(503);
			expect(error.statusMessage).toBe('Service Unavailable');
			expect(error.message).toBe('Service down');
		});

		it('should include retry after', () => {
			const error = new ServiceUnavailableError('Service down', 300);

			expect(error.details).toEqual({ retryAfter: 300 });
		});
	});

	describe('GatewayTimeoutError', () => {
		it('should create 504 error', () => {
			const error = new GatewayTimeoutError('Upstream timeout');

			expect(error.statusCode).toBe(504);
			expect(error.statusMessage).toBe('Gateway Timeout');
			expect(error.message).toBe('Upstream timeout');
		});
	});
});

describe('createError factory', () => {
	it('should create badRequest error', () => {
		const error = createError.badRequest('Invalid input');

		expect(error).toBeInstanceOf(BadRequestError);
		expect(error.statusCode).toBe(400);
	});

	it('should create unauthorized error', () => {
		const error = createError.unauthorized('Invalid token');

		expect(error).toBeInstanceOf(UnauthorizedError);
		expect(error.statusCode).toBe(401);
	});

	it('should create forbidden error', () => {
		const error = createError.forbidden('Access denied');

		expect(error).toBeInstanceOf(ForbiddenError);
		expect(error.statusCode).toBe(403);
	});

	it('should create notFound error', () => {
		const error = createError.notFound('Resource not found');

		expect(error).toBeInstanceOf(NotFoundError);
		expect(error.statusCode).toBe(404);
	});

	it('should create methodNotAllowed error', () => {
		const error = createError.methodNotAllowed('Method not allowed', [
			'GET',
			'POST',
		]);

		expect(error).toBeInstanceOf(MethodNotAllowedError);
		expect(error.statusCode).toBe(405);
	});

	it('should create conflict error', () => {
		const error = createError.conflict('Resource exists');

		expect(error).toBeInstanceOf(ConflictError);
		expect(error.statusCode).toBe(409);
	});

	it('should create unprocessableEntity error', () => {
		const error = createError.unprocessableEntity('Validation failed');

		expect(error).toBeInstanceOf(UnprocessableEntityError);
		expect(error.statusCode).toBe(422);
	});

	it('should create tooManyRequests error', () => {
		const error = createError.tooManyRequests('Rate limited', 60);

		expect(error).toBeInstanceOf(TooManyRequestsError);
		expect(error.statusCode).toBe(429);
	});

	it('should create internalServerError error', () => {
		const error = createError.internalServerError('Server error');

		expect(error).toBeInstanceOf(InternalServerError);
		expect(error.statusCode).toBe(500);
	});

	it('should create notImplemented error', () => {
		const error = createError.notImplemented('Not implemented');

		expect(error).toBeInstanceOf(NotImplementedError);
		expect(error.statusCode).toBe(501);
	});

	it('should create badGateway error', () => {
		const error = createError.badGateway('Gateway error');

		expect(error).toBeInstanceOf(BadGatewayError);
		expect(error.statusCode).toBe(502);
	});

	it('should create serviceUnavailable error', () => {
		const error = createError.serviceUnavailable('Service down', 300);

		expect(error).toBeInstanceOf(ServiceUnavailableError);
		expect(error.statusCode).toBe(503);
	});

	it('should create gatewayTimeout error', () => {
		const error = createError.gatewayTimeout('Timeout');

		expect(error).toBeInstanceOf(GatewayTimeoutError);
		expect(error.statusCode).toBe(504);
	});
});

describe('createHttpError function', () => {
	it('should create error with valid status code', () => {
		const error = createHttpError(404, 'Not found');

		expect(error).toBeInstanceOf(NotFoundError);
		expect(error.statusCode).toBe(404);
		expect(error.message).toBe('Not found');
	});

	it('should create error with type-safe options', () => {
		const error = createHttpError(429, 'Rate limited', { retryAfter: 60 });

		expect(error).toBeInstanceOf(TooManyRequestsError);
		expect(error.details).toEqual({ retryAfter: 60 });
	});

	it('should create error with validation errors', () => {
		const error = createHttpError(422, 'Validation failed', {
			validationErrors: { email: 'Invalid' },
		});

		expect(error).toBeInstanceOf(UnprocessableEntityError);
		expect(error.details).toEqual({
			validationErrors: { email: 'Invalid' },
		});
	});

	it('should create error with allowed methods', () => {
		const error = createHttpError(405, 'Method not allowed', {
			allowedMethods: ['GET', 'POST'],
		});

		expect(error).toBeInstanceOf(MethodNotAllowedError);
		expect(error.details).toEqual({ allowedMethods: ['GET', 'POST'] });
	});

	it('should create generic error for unknown status code', () => {
		const error = createHttpError(418, 'I am a teapot');

		expect(error).toBeInstanceOf(HttpError);
		expect(error.statusCode).toBe(418);
		expect(error.message).toBe('I am a teapot');
	});
});

describe('Type guards', () => {
	describe('isHttpError', () => {
		it('should return true for HttpError instances', () => {
			const error = new HttpError(400);

			expect(isHttpError(error)).toBe(true);
		});

		it('should return true for HttpError subclasses', () => {
			const error = new NotFoundError();

			expect(isHttpError(error)).toBe(true);
		});

		it('should return true for duck-typed errors', () => {
			const error = {
				statusCode: 400,
				statusMessage: 'Bad Request',
				message: 'Error',
				isHttpError: true,
			};

			expect(isHttpError(error)).toBe(true);
		});

		it('should return false for regular errors', () => {
			const error = new Error('Regular error');

			expect(isHttpError(error)).toBe(false);
		});

		it('should return false for non-errors', () => {
			expect(isHttpError(null)).toBe(false);
			expect(isHttpError(undefined)).toBe(false);
			expect(isHttpError('string')).toBe(false);
			expect(isHttpError(123)).toBe(false);
			expect(isHttpError({})).toBe(false);
		});
	});

	describe('isClientError', () => {
		it('should return true for 4xx errors', () => {
			const error = new BadRequestError();

			expect(isClientError(error)).toBe(true);
		});

		it('should return false for 5xx errors', () => {
			const error = new InternalServerError();

			expect(isClientError(error)).toBe(false);
		});

		it('should return false for non-http errors', () => {
			const error = new Error('Regular error');

			expect(isClientError(error)).toBe(false);
		});
	});

	describe('isServerError', () => {
		it('should return true for 5xx errors', () => {
			const error = new InternalServerError();

			expect(isServerError(error)).toBe(true);
		});

		it('should return false for 4xx errors', () => {
			const error = new NotFoundError();

			expect(isServerError(error)).toBe(false);
		});

		it('should return false for non-http errors', () => {
			const error = new Error('Regular error');

			expect(isServerError(error)).toBe(false);
		});
	});
});

describe('wrapError', () => {
	it('should return HttpError unchanged', () => {
		const original = new NotFoundError('Not found');
		const wrapped = wrapError(original);

		expect(wrapped).toBe(original);
	});

	it('should wrap unknown errors as 500', () => {
		const original = new Error('Something went wrong');
		const wrapped = wrapError(original);

		expect(wrapped).toBeInstanceOf(HttpError);
		expect(wrapped.statusCode).toBe(500);
		expect(wrapped.message).toBe('An unknown error occurred');
		expect(wrapped.details?.originalError).toBe(original);
	});

	it('should wrap with custom status code', () => {
		const original = new Error('Service unavailable');
		const wrapped = wrapError(original, 503);

		expect(wrapped.statusCode).toBe(503);
	});

	it('should wrap with custom message', () => {
		const original = new Error('Database error');
		const wrapped = wrapError(original, 500, 'Failed to query database');

		expect(wrapped.statusCode).toBe(500);
		expect(wrapped.message).toBe('Failed to query database');
		expect(wrapped.details?.originalError).toBe(original);
	});

	it('should handle non-error values', () => {
		const wrapped = wrapError('string error');

		expect(wrapped).toBeInstanceOf(HttpError);
		expect(wrapped.statusCode).toBe(500);
		expect(wrapped.details?.originalError).toBe('string error');
	});
});

describe('HttpStatusCode enum', () => {
	it('should have 2xx success codes', () => {
		expect(HttpStatusCode.OK).toBe(200);
		expect(HttpStatusCode.CREATED).toBe(201);
		expect(HttpStatusCode.ACCEPTED).toBe(202);
		expect(HttpStatusCode.NO_CONTENT).toBe(204);
	});

	it('should have 3xx redirect codes', () => {
		expect(HttpStatusCode.MOVED_PERMANENTLY).toBe(301);
		expect(HttpStatusCode.FOUND).toBe(302);
		expect(HttpStatusCode.NOT_MODIFIED).toBe(304);
	});

	it('should have 4xx client error codes', () => {
		expect(HttpStatusCode.BAD_REQUEST).toBe(400);
		expect(HttpStatusCode.UNAUTHORIZED).toBe(401);
		expect(HttpStatusCode.FORBIDDEN).toBe(403);
		expect(HttpStatusCode.NOT_FOUND).toBe(404);
		expect(HttpStatusCode.METHOD_NOT_ALLOWED).toBe(405);
		expect(HttpStatusCode.NOT_ACCEPTABLE).toBe(406);
		expect(HttpStatusCode.REQUEST_TIMEOUT).toBe(408);
		expect(HttpStatusCode.CONFLICT).toBe(409);
		expect(HttpStatusCode.GONE).toBe(410);
		expect(HttpStatusCode.UNPROCESSABLE_ENTITY).toBe(422);
		expect(HttpStatusCode.TOO_MANY_REQUESTS).toBe(429);
	});

	it('should have 5xx server error codes', () => {
		expect(HttpStatusCode.INTERNAL_SERVER_ERROR).toBe(500);
		expect(HttpStatusCode.NOT_IMPLEMENTED).toBe(501);
		expect(HttpStatusCode.BAD_GATEWAY).toBe(502);
		expect(HttpStatusCode.SERVICE_UNAVAILABLE).toBe(503);
		expect(HttpStatusCode.GATEWAY_TIMEOUT).toBe(504);
	});
});
