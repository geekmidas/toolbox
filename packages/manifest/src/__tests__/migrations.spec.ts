import { describe, expect, it } from 'vitest';
import type { ConstructManifest } from '../declaration';
import { migrationFolder, migrationTargets } from '../migrations';
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
			{ id: 'Database', folder: 'db/database' },
			{ id: 'AuthDatabase', folder: 'db/auth-database', of: 'Database' },
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

describe('migrationFolder', () => {
	it('is named by the construct, in kebab case', () => {
		expect(migrationFolder('AuthDatabase')).toBe('db/auth-database');
		expect(migrationFolder('S3Archive')).toBe('db/s3-archive');
	});

	it('reads back to the construct it names', () => {
		expect(canonicalId('auth-database')).toBe('AuthDatabase');
	});
});
