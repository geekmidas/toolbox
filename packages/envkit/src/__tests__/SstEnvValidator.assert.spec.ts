import { describe, expect, it } from 'vitest';
import { ResourceType } from '../SstEnvironmentBuilder';
import { EnvValidationError, EnvValidator } from '../sst';

describe('EnvValidator.assert', () => {
	it('passes when every required variable is provided', () => {
		const validator = new EnvValidator(
			{ db: { type: ResourceType.Postgres } },
			{ whitelist: ['APP_NAME'] },
		);

		expect(() =>
			validator.assert(['DB_HOST', 'APP_NAME', 'SENTRY_DSN?']),
		).not.toThrow();
	});

	it('names the unit, the missing variables, and the likely intended ones', () => {
		const validator = new EnvValidator(
			{ db: { type: ResourceType.Postgres } },
			{ context: 'orders-fn' },
		);

		let error: unknown;
		try {
			validator.assert(['DATABASE_URL', 'TOTALLY_UNRELATED']);
		} catch (e) {
			error = e;
		}

		expect(error).toBeInstanceOf(EnvValidationError);
		const message = (error as Error).message;
		expect(message).toContain("'orders-fn' is missing required env vars:");
		expect(message).toMatch(/- DATABASE_URL\s+\(did you mean DB_URL/);
		// No hint, and no trailing padding, for a variable nothing resembles.
		expect(message).toMatch(/- TOTALLY_UNRELATED\n/);
		expect(message).toContain('Provided by links: DB_');
	});

	it('says a deployable unit when none is named, and that no links provide anything', () => {
		const validator = new EnvValidator({});

		expect(() => validator.assert(['API_KEY'])).toThrow(
			/a deployable unit is missing required env vars:[\s\S]*\(no links provide environment variables\)/,
		);
	});

	it('lists at most eight provided variables, counting the rest', () => {
		const validator = new EnvValidator({
			db: { type: ResourceType.Postgres },
			cache: { type: ResourceType.Postgres },
		});

		expect(() => validator.assert(['NOPE'])).toThrow(/\.\.\.\(\+\d+\)/);
	});
});
