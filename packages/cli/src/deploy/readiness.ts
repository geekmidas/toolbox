/**
 * Whether a stage is ready to be deployed: the one check, run once by every
 * deploy through a server target — after the stage's providers have created
 * what they create and written its keys, and before the target touches
 * anything.
 *
 * A build is not a deploy. Images carry no stage's keys, so a build-only run
 * (`gkm compose --build --push`) never calls this: a key the deploy itself
 * writes — a provider's bucket URL — is not there yet when CI builds, and
 * must not stop the build.
 */

import {
	assertStageProvidersEnabled,
	stageProviderNotes,
	verifyStageProviders,
} from '../providers/index.js';
import { constructGlobs } from '../reconcile/workspace.js';
import { assertStageCredentials } from '../secrets/credentialSchemas.js';
import { assertNoStaleSecrets } from '../secrets/stale.js';
import type { DeployPhaseContext } from '../target/types';
import {
	devServicesUsed,
	ExternalServicesNotConfigured,
	externalServices,
	reportDevServices,
	stageServiceDeclarations,
} from './devServices';

/**
 * The stage has every key it needs, read from its secrets as the providers
 * left them:
 *
 * 1. no kind it declares is one the stage set to `false`;
 * 2. its mail and storage are its own — or a dev service, where allowed,
 *    reported once, loudly;
 * 3. what its providers created is still there, and its key reaches it;
 * 4. no key holds an address an older gkm stored for what a construct now
 *    provides;
 * 5. each third party's credentials match their construct's schema.
 *
 * The local stage derives its mail and storage, so only 4 and 5 apply to it.
 *
 * @throws {StageProviderDisabled}
 * @throws {ExternalServicesNotConfigured} naming every missing key at once
 * @throws {StaleStageSecrets}
 * @throws {CredentialsInvalid}
 */
export async function assertStageReady(
	ctx: DeployPhaseContext<unknown>,
): Promise<void> {
	const { workspace, manifest, stage } = ctx;
	// Read now, not before the providers ran: they just wrote keys.
	const supplied = (await ctx.secrets.read())?.custom ?? {};

	if (stage !== workspace.stages.local) {
		assertStageProvidersEnabled(workspace, manifest, stage);

		const domain = workspace.domains?.[stage];
		const services = externalServices({
			stage,
			declarations: stageServiceDeclarations({
				manifest,
				...(ctx.runnables ? { runnables: ctx.runnables } : {}),
			}),
			supplied,
			allow: ctx.allowDevServices,
			...(domain ? { domain } : {}),
			providers: stageProviderNotes(workspace, stage),
		});
		if (services.missing.length > 0) {
			throw new ExternalServicesNotConfigured(stage, services.missing);
		}
		// Loud, every deploy — a dry run included: a deployed stage on Mailpit
		// delivers no mail, and one on MinIO keeps its files on one disk.
		reportDevServices(ctx, devServicesUsed(services));

		const verified = await verifyStageProviders({
			workspace,
			manifest,
			stage,
			secrets: supplied,
			// What the providers just recorded: a key issued by this deploy.
			resources: (await ctx.state.read(stage))?.resources ?? {},
			log: (line) => ctx.logger.info(line),
		});
		for (const line of verified) ctx.logger.info(`✓ ${line} verified`);
	}

	// Set by hand wins, so every app would be handed `localhost`.
	assertNoStaleSecrets({ manifest, stage, supplied });
	// Before anything is built with one every app reading it would refuse.
	await assertStageCredentials({
		root: workspace.root,
		patterns: constructGlobs(workspace),
		manifest,
		stage,
		supplied,
	});
}
