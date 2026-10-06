import { describe, expect, it } from 'vitest';
import { ImageRefInvalid, validateImageRef } from '../imageRef';

describe('validateImageRef', () => {
	it.each([
		'api',
		'api:latest',
		'shop-api:v1',
		'ghcr.io/acme/shop-api:v1',
		'localhost:5000/api:dev',
		'registry.example.com:443/team/sub/api:1.2.3-beta.1',
		'gcr.io/my-project/images/api:sha-abc123',
		'docker.io/library/node:22-alpine',
		'api_v2__x:TAG_1',
		`api@sha256:${'a'.repeat(64)}`,
	])('accepts %s', (ref) => {
		expect(validateImageRef(ref)).toBe(ref);
	});

	it.each([
		['a shell separator', 'ghcr.io/acme/api:v1;rm -rf /'],
		['a command substitution', 'ghcr.io/acme/api:$(id)'],
		['a backtick', 'api:`id`'],
		['a space', 'api:v1 --push'],
		['a leading dash', '--privileged'],
		['a tag starting with a dash', 'api:-v1'],
		['a tag starting with a dot', 'api:.v1'],
		['an uppercase name', 'ghcr.io/Acme/api:v1'],
		['an empty tag', 'api:'],
		['an empty string', ''],
		['a newline', 'api:v1\n--rm'],
		['a tag over 128 characters', `api:${'a'.repeat(129)}`],
		['a name over 255 characters', `${'a'.repeat(256)}:v1`],
	])('refuses %s', (_, ref) => {
		expect(() => validateImageRef(ref)).toThrow(ImageRefInvalid);
	});

	it('names the ref it refused', () => {
		const ref = 'api:$(id)';
		try {
			validateImageRef(ref);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(ImageRefInvalid);
			expect((error as ImageRefInvalid).ref).toBe(ref);
			expect((error as Error).message).toContain('docker.registry');
		}
	});
});
