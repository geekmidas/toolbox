import { describe, expect, it } from 'vitest';
import {
	BadGatewayError,
	BadRequestError,
	ConflictError,
	createHttpError,
	ForbiddenError,
	GatewayTimeoutError,
	InternalServerError,
	NotImplementedError,
	ServiceUnavailableError,
	TooManyRequestsError,
	UnauthorizedError,
	UnprocessableEntityError,
} from '../index';

describe('createHttpError', () => {
	it.each([
		[400, BadRequestError],
		[401, UnauthorizedError],
		[403, ForbiddenError],
		[409, ConflictError],
		[500, InternalServerError],
		[501, NotImplementedError],
		[502, BadGatewayError],
		[504, GatewayTimeoutError],
	] as const)('builds the %s error class with its details', (status, ErrorClass) => {
		const error = createHttpError(status, 'went wrong', {
			details: { field: 'email' },
		});

		expect(error).toBeInstanceOf(ErrorClass);
		expect(error.statusCode).toBe(status);
		expect(error.message).toBe('went wrong');
		expect(error.details).toEqual({ field: 'email' });
	});

	it('builds a 503 that says when to retry', () => {
		const error = createHttpError(503, 'down for maintenance', {
			retryAfter: 120,
		});

		expect(error).toBeInstanceOf(ServiceUnavailableError);
		expect(error.statusCode).toBe(503);
		expect(error.details).toEqual({ retryAfter: 120 });
	});

	it.each([
		[409, ConflictError],
		[422, UnprocessableEntityError],
		[429, TooManyRequestsError],
	] as const)('keeps the code a %s is given', (status, ErrorClass) => {
		const cause = new Error('underlying');
		const error = createHttpError(status, 'refused', {
			code: 'REFUSED',
			cause,
		});

		expect(error).toBeInstanceOf(ErrorClass);
		expect(error.code).toBe('REFUSED');
		expect(error.cause).toBe(cause);
	});

	it('names the reason phrase of a precondition that failed', () => {
		expect(createHttpError(412, 'stale').statusMessage).toBe(
			'Precondition Failed',
		);
	});
});
