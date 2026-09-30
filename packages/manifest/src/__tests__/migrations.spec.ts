import { describe, expect, it } from 'vitest';
import type { ConstructManifest } from '../declaration';
import {
	databaseFolder,
	migrationFolder,
	migrationTargets,
	seedFolder,
} from '../migrations';
import { canonicalId } from '../naming';

/**
 * A tenant declared before its parent, a reader, and a cache in the database —
 * everything that is *about* a database without every one of them taking
 * migrations.
 */
const manifest = {
	AuthDatabase: {
		kind: 'database-schema',
		id: 'AuthDatabase',
		of: 'Database',
		schema: 'auth_database',
		provides: ['AUTH_DATABASE_URL'],
	},
	DatabaseReader: {
		kind: 'database-reader',
		id: 'DatabaseReader',
		of: 'Database',
		provides: ['DATABASE_READER_URL'],
	},
	Sessions: {
		kind: 'cache',
		id: 'Sessions',
		of: 'Database',
		provides: ['SESSIONS_URL'],
	},
	Database: { kind: 'database', id: 'Database', provides: ['DATABASE_URL'] },
} as const satisfies ConstructManifest;

describe('migrationTargets', () => {
	it('is every database and tenant, parents first, each in its own folder', () => {
		expect(migrationTargets(manifest)).toEqual([
			{
				id: 'Database',
				folder: 'db/database',
				migrations: 'db/database/migrations',
				seeds: 'db/database/seeds',
			},
			{
				id: 'AuthDatabase',
				folder: 'db/auth-database',
				migrations: 'db/auth-database/migrations',
				seeds: 'db/auth-database/seeds',
				of: 'Database',
			},
		]);
	});

	it('is nothing for a project with no database', () => {
		expect(
			migrationTargets({
				Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
			}),
		).toEqual([]);
	});
});

describe('databaseFolder', () => {
	it('is named by the construct, in kebab case', () => {
		expect(databaseFolder('AuthDatabase')).toBe('db/auth-database');
		expect(databaseFolder('S3Archive')).toBe('db/s3-archive');
	});

	it('holds the migrations and the seeds, each in a folder of its own', () => {
		expect(migrationFolder('AuthDatabase')).toBe('db/auth-database/migrations');
		expect(seedFolder('AuthDatabase')).toBe('db/auth-database/seeds');
	});

	it('reads back to the construct it names', () => {
		expect(canonicalId('auth-database')).toBe('AuthDatabase');
	});
});
