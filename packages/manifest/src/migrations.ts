/**
 * Which constructs take migrations, where their files live, and in what order
 * they run — resolved once, from the manifest.
 *
 * `gkm migrate`, `gkm test`, `gkm migration` and every deploy target ask the
 * same question. Each deriving it on its own is how one of them comes to
 * migrate a reader, skip a tenant, or run a tenant's files before the parent
 * that owns its schema exists.
 */

import type { ConstructId, ConstructManifest } from './declaration';
import { provisionOrder } from './derive';
import { kebabCase } from './naming';

/** Where every construct's migrations folder lives, from the project root. */
export const MIGRATIONS_ROOT = 'db';

/** One construct whose schema is changed by migrations. */
export interface MigrationTarget {
	/** The construct's canonical id, e.g. `AuthDatabase`. */
	id: ConstructId;
	/** Its folder, relative to the project root: `db/auth-database`. */
	folder: string;
	/** For a schema tenant, the database it lives in. */
	of?: ConstructId;
}

/**
 * The constructs that take migrations, parents before the tenants inside them.
 *
 * A database and each schema tenant: every one has an owner role and a schema
 * of its own, and so a history of its own. A reader has neither — it reads its
 * parent's schema — and a cache's table is created by provisioning, not by a
 * migration anyone writes.
 */
export function migrationTargets(
	manifest: ConstructManifest,
): MigrationTarget[] {
	return provisionOrder(manifest).flatMap((id) => {
		const declaration = manifest[id];
		if (!declaration) return [];

		if (declaration.kind === 'database') return [target(id)];
		if (declaration.kind === 'database-schema') {
			return [{ ...target(id), of: declaration.of }];
		}

		return [];
	});
}

/**
 * The folder a construct's migrations live in, relative to the project root.
 *
 * Named by the construct — `AuthDatabase` is `db/auth-database` — in the case
 * every other name outside TypeScript takes. Lowercase, because a folder that
 * differs from another only in case is two folders on Linux and one on a Mac;
 * and `canonicalId` reads it back to the construct exactly, which is how a
 * folder naming nothing is caught rather than skipped.
 */
export function migrationFolder(id: ConstructId): string {
	return `${MIGRATIONS_ROOT}/${kebabCase(id)}`;
}

function target(id: ConstructId): MigrationTarget {
	return { id, folder: migrationFolder(id) };
}
