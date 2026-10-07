/**
 * The built-in `dokploy` target: the Dokploy engine `gkm deploy` has always
 * run, behind the phases.
 *
 * - `provision`: the project, environment and registry, and what the
 *   manifest declares — its databases' roles applied over a port published
 *   for the purpose.
 * - `release`: the stage's migrations, then each image built and pushed
 *   beside its application and deployed, waited on until Dokploy has
 *   finished; backends first and checked before any site is released.
 * - `verify`: each site answering its health check.
 * - `rollback`: what failed — or, `--atomic`, everything the run released —
 *   pointed back at the image it ran before.
 */

import { defineTarget } from '../define';
import {
	type DokployRun,
	dokployResult,
	planDokploy,
	provisionDokploy,
	releaseDokploy,
	rollbackDokploy,
	validateDokploy,
	verifyDokploy,
} from './engine';

export const dokployTarget = defineTarget<undefined, DokployRun>({
	name: 'dokploy',
	runtime: 'server',
	capabilities: { rollback: true, migrations: 'target', images: true },
	credentials: ['dokploy', 'registry'],
	validate: (ctx) => validateDokploy(ctx),
	plan: (_ctx, run) => planDokploy(run),
	provision: (_ctx, run) => provisionDokploy(run),
	release: (_ctx, run) => releaseDokploy(run),
	verify: (_ctx, run) => verifyDokploy(run),
	rollback: (_ctx, run, failure) => rollbackDokploy(run, failure),
	result: (_ctx, run) => dokployResult(run),
});
