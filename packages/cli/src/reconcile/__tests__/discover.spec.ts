import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UnknownParent } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { DuplicateConstruct, discover, isDeclarable } from '../discover';

const fixtures = join(__dirname, '__fixtures__');

const found = () => discover({ patterns: 'constructs/**/*.ts', cwd: fixtures });

describe('isDeclarable', () => {
	it('accepts anything with an id that can declare', () => {
		// Structural, not instanceof: a construct from a second copy of the
		// package in a lockfile is still a construct.
		expect(isDeclarable({ id: 'Uploads', declare: () => [] })).toBe(true);
	});

	it('rejects a service', () => {
		// `{ serviceName, register }` simply does not match, which is how
		// `.dependsOn()` gets its enforcement with no instanceof anywhere.
		expect(isDeclarable({ serviceName: 'db', register: () => {} })).toBe(false);
	});

	it('rejects an object with an id but no declare', () => {
		expect(isDeclarable({ id: 'Uploads' })).toBe(false);
	});

	it('rejects an empty id', () => {
		expect(isDeclarable({ id: '', declare: () => [] })).toBe(false);
	});

	it('rejects null and primitives', () => {
		expect(isDeclarable(null)).toBe(false);
		expect(isDeclarable('Uploads')).toBe(false);
		expect(isDeclarable(undefined)).toBe(false);
	});
});

describe('discover', () => {
	it('finds every construct under one glob', async () => {
		// One glob, not one per kind — a resource has no kind to be listed under.
		expect(Object.keys(await found()).sort()).toEqual([
			'Auth',
			'Mail',
			'Orders',
			'Uploads',
		]);
	});

	it('finds constructs in nested directories', async () => {
		expect(await found()).toHaveProperty('Orders');
	});

	it('finds several constructs in one file', async () => {
		const manifest = await found();

		expect(manifest).toHaveProperty('Uploads');
		expect(manifest).toHaveProperty('Mail');
	});

	it('ignores exports that are not constructs', async () => {
		expect(await found()).not.toHaveProperty('Nope');
	});

	it('keys the manifest by id', async () => {
		expect((await found()).Uploads).toEqual({
			kind: 'objects',
			id: 'Uploads',
			provides: ['UPLOADS_URL'],
		});
	});

	it('returns an empty manifest when nothing matches', async () => {
		expect(
			await discover({ patterns: 'nothing/**/*.ts', cwd: fixtures }),
		).toEqual({});
	});

	it('rejects two constructs claiming one id', async () => {
		const cwd = await mkdtemp(join(tmpdir(), 'gkm-discover-'));
		try {
			const declare = (name: string) =>
				`export const ${name} = { id: 'Uploads', declare: () => [{ kind: 'objects', id: 'Uploads' }] };\n`;
			await writeFile(join(cwd, 'a.ts'), declare('a'));
			await writeFile(join(cwd, 'b.ts'), declare('b'));

			await expect(discover({ patterns: '*.ts', cwd })).rejects.toThrow(
				DuplicateConstruct,
			);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it('rejects a tenant whose parent was deleted', async () => {
		// Reference integrity here, where the error can name a file, rather than
		// at deploy.
		const cwd = await mkdtemp(join(tmpdir(), 'gkm-discover-'));
		try {
			await writeFile(
				join(cwd, 'orphan.ts'),
				`export const auth = { id: 'Auth', declare: () => [{ kind: 'database-schema', id: 'Auth', of: 'Gone', schema: 'auth' }] };\n`,
			);

			await expect(discover({ patterns: '*.ts', cwd })).rejects.toThrow(
				UnknownParent,
			);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
