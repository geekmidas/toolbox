import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import type { ConstructSource } from '../reconcile/discover.js';
import { servedSurface } from './owners';

/** A construct that builds its own server — `BetterAuth` and its routes. */
interface ServesItself {
	server(options: unknown): Promise<{ app: unknown }>;
}

/** Whether a construct serves itself, asked of the construct. */
export function servesItself(construct: unknown): construct is ServesItself {
	return (
		typeof (construct as { server?: unknown } | null)?.server === 'function'
	);
}

/**
 * The surface this app serves, when that surface serves itself.
 *
 * An auth server's routes are a wildcard the construct mounts, so a glob finds
 * nothing and the entry only has to start it. That used to be inferred —
 * "nothing found, and the surface declares routes" — which is a guess about
 * the construct from the outside. The construct can simply be asked.
 */
export function selfServingSurface(options: {
	declared: ConstructManifest;
	sources: Record<string, ConstructSource>;
	workspaceRoot: string;
	appRoot: string;
}): { id: string; source: ConstructSource } | undefined {
	const { declared, sources, workspaceRoot, appRoot } = options;

	const served = servedSurface(declared, workspaceRoot, appRoot);
	const source = served ? sources[served.id] : undefined;

	if (!served || !source || !servesItself(source.construct)) return undefined;

	return { id: served.id, source };
}

/**
 * The entry for a surface that serves itself.
 *
 * Two lines, because the construct owns the serving. A generator writing the
 * mounts would be a second description of routes the declaration already
 * carries — which is how Better Auth came to be mounted by a hand-written hook,
 * and then served by nothing at all when that hook was deleted for duplicating
 * CORS the graph had started deriving.
 *
 * The import specifier comes from discovery, which globbed the file and
 * imported it. Nothing about the surface is named here.
 */
export async function writeSurfaceEntry(
	outputDir: string,
	source: ConstructSource,
): Promise<void> {
	await mkdir(outputDir, { recursive: true });

	const rel = relative(outputDir, source.file).replace(/\.ts$/, '.js');
	const specifier = rel.startsWith('.') ? rel : `./${rel}`;

	await writeFile(
		join(outputDir, 'app.ts'),
		`/**
 * Generated entry for a surface that serves itself.
 *
 * Its routes, its CORS origins and its clients all come from the construct's
 * own declaration. This file exists only to start it.
 */
import { snifferContext } from '@geekmidas/constructs';
import { defaultEnvParser } from '@geekmidas/constructs/endpoints';
import { ${source.exportName} as surface } from '${specifier}';

const envParser = defaultEnvParser();

export const { app } = await surface.server({ envParser, context: snifferContext });

export default app;
`,
	);
}
