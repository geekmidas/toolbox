import { e } from '@geekmidas/constructs/endpoints';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { OpenApiTsGenerator } from '../OpenApiTsGenerator';

describe('OpenApiTsGenerator — zod global registry', () => {
	beforeEach(() => {
		z.globalRegistry.clear();
	});

	afterEach(() => {
		z.globalRegistry.clear();
	});

	it('emits a named interface for a registered schema even when no endpoint references it directly', async () => {
		const UserSchema = z
			.object({
				id: z.string(),
				email: z.string(),
				name: z.string(),
			})
			.meta({ id: 'User' });

		const UserResponseSchema = UserSchema.pick({
			id: true,
			name: true,
			email: true,
		});

		const endpoint = e
			.get('/users/:id')
			.output(UserResponseSchema)
			.handle(async () => ({ id: '1', name: 'a', email: 'a@b.c' }));

		const generator = new OpenApiTsGenerator();
		const content = await generator.generate([endpoint as any]);

		expect(content).toMatch(/export interface User\b/);
	});

	it('does not duplicate when the same id is also produced by an endpoint', async () => {
		const UserSchema = z
			.object({
				id: z.string(),
				email: z.string(),
				name: z.string(),
			})
			.meta({ id: 'User' });

		const endpoint = e
			.get('/users/:id')
			.output(UserSchema)
			.handle(async () => ({ id: '1', name: 'a', email: 'a@b.c' }));

		const generator = new OpenApiTsGenerator();
		const content = await generator.generate([endpoint as any]);

		const occurrences = content.match(/export interface User\b/g) ?? [];
		expect(occurrences.length).toBe(1);
	});

	it('emits multiple registered schemas', async () => {
		z.object({ id: z.string() }).meta({ id: 'Foo' });
		z.object({ id: z.string() }).meta({ id: 'Bar' });

		const endpoint = e
			.get('/ping')
			.output(z.object({ ok: z.boolean() }))
			.handle(async () => ({ ok: true }));

		const generator = new OpenApiTsGenerator();
		const content = await generator.generate([endpoint as any]);

		expect(content).toMatch(/export interface Foo\b/);
		expect(content).toMatch(/export interface Bar\b/);
	});

	it('references one registered schema from another via the parent type', async () => {
		const UserSchema = z
			.object({ id: z.string(), email: z.string() })
			.meta({ id: 'User' });

		z.object({ user: UserSchema, role: z.string() }).meta({ id: 'UserRole' });

		const endpoint = e
			.get('/ping')
			.output(z.object({ ok: z.boolean() }))
			.handle(async () => ({ ok: true }));

		const generator = new OpenApiTsGenerator();
		const content = await generator.generate([endpoint as any]);

		expect(content).toMatch(/export interface User\b/);
		expect(content).toMatch(/export interface UserRole\b/);
		// `user` inside UserRole should reference the named User type, not inline.
		expect(content).toMatch(/user:\s*User\b/);
	});
});
