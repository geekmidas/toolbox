/**
 * The built-in `dokploy` target: the Dokploy engine `gkm deploy` has always
 * run, behind the phases.
 *
 * What it does is unchanged — the same requests, the same images, the same
 * progress lines — and so is what it does not do yet: it builds each image
 * inside `release`, beside its application, has no rollback, and leaves
 * migrations to the app. Verification, rollback and migrations are #151's.
 */

import {
	type DokployRun,
	dokployResult,
	planDokploy,
	provisionDokploy,
	releaseDokploy,
	validateDokploy,
	verifyDokploy,
} from '../deploy/index';
import { defineTarget } from './define';

export const dokployTarget = defineTarget<undefined, DokployRun>({
	name: 'dokploy',
	runtime: 'server',
	capabilities: { rollback: false, migrations: 'app', images: true },
	credentials: ['dokploy', 'registry'],
	validate: (ctx) => validateDokploy(ctx),
	plan: (_ctx, run) => planDokploy(run),
	provision: (_ctx, run) => provisionDokploy(run),
	release: (_ctx, run) => releaseDokploy(run),
	verify: (_ctx, run) => verifyDokploy(run),
	result: (_ctx, run) => dokployResult(run),
});
