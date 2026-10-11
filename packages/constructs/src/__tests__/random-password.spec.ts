import { EnvironmentParser } from '@geekmidas/envkit';
import { describe, expect, it } from 'vitest';
import { RandomPassword } from '../random-password';

const register = (password: RandomPassword, env: Record<string, string>) =>
	password.service.register({
		envParser: new EnvironmentParser(env),
	} as never);

describe('RandomPassword', () => {
	const admin = new RandomPassword('AdminPassword');

	it('declares a secret, so every stage generates and keeps it', () => {
		expect(admin.declare()).toEqual([
			{ kind: 'secret', id: 'AdminPassword', provides: ['ADMIN_PASSWORD'] },
		]);
	});

	it('is a service under its camel-cased id', () => {
		expect(admin.service.serviceName).toBe('adminPassword');
	});

	it('hands a handler the value its stage holds', async () => {
		expect(await register(admin, { ADMIN_PASSWORD: 'k3J-x_9' })).toBe(
			'k3J-x_9',
		);
	});

	it('canonicalises its id, and its key with it', () => {
		expect(new RandomPassword('admin-password' as never).declare()).toEqual(
			admin.declare(),
		);
	});

	it('refuses to start without one', async () => {
		await expect(async () => register(admin, {})).rejects.toThrow();
	});
});
