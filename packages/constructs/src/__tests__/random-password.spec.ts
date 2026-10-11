import { EnvironmentParser } from '@geekmidas/envkit';
import { describe, expect, it } from 'vitest';
import { InvalidPasswordLength, RandomPassword } from '../random-password';

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

	it('declares the format a stage draws it in', () => {
		expect(
			new RandomPassword('RouterPassword', {
				length: 24,
				symbols: '!@#',
			}).declare(),
		).toEqual([
			{
				kind: 'secret',
				id: 'RouterPassword',
				provides: ['ROUTER_PASSWORD'],
				length: 24,
				symbols: '!@#',
			},
		]);
	});

	it.each([0, -1, 12.5, Number.NaN])('refuses a length of %s', (length) => {
		expect(() => new RandomPassword('RouterPassword', { length })).toThrow(
			InvalidPasswordLength,
		);
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
