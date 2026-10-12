/**
 * How a deployed stage ships a mobile app: the EAS environment its builds
 * read, the channel its updates go out on, and the Play track and release
 * status its Android builds are submitted with.
 *
 * Defaulted from the stages gkm.config.ts declares — the protected stage is
 * the one users have, so it reads EAS's `production` environment and
 * submits to Play's `production` track; every other deployed stage reads
 * `preview` and submits to `internal` — and overridden per stage on the
 * `MobileApp` (`stages`). Every Android release is a `draft` until someone
 * releases it in Play Console, unless the stage says `completed`.
 */

import type {
	MobileAppDeclaration,
	PlayReleaseStatus,
	PlayTrack,
} from '@geekmidas/manifest';
import { GkmError } from '../errors';
import type { NormalizedWorkspace } from '../workspace/types.js';

/** One stage's way of shipping a mobile app, every default applied. */
export interface MobileStage {
	stage: string;
	/** The EAS environment its builds read their variables from. */
	environment: string;
	/** The EAS Update channel its store builds listen on: the stage's name. */
	channel: string;
	android: { track: PlayTrack; releaseStatus: PlayReleaseStatus };
}

/** A `MobileApp`'s `stages` names a stage the project does not deploy. */
export class MobileAppStageUndeclared extends GkmError {
	constructor(
		readonly app: string,
		readonly stage: string,
		readonly deployed: readonly string[],
	) {
		super(
			`'${app}' says how the stage '${stage}' ships it, and '${stage}' is not ` +
				`a deployed stage (gkm.config.ts deploys ${deployed.join(', ') || 'nothing'}). ` +
				`Rename it in the MobileApp's stages, or add it to stages.deployed.`,
		);
		this.name = 'MobileAppStageUndeclared';
	}
}

/**
 * `stage`'s way of shipping `app`.
 *
 * @throws {MobileAppStageUndeclared} when the app's `stages` names a stage
 *   the workspace does not deploy
 */
export function mobileStage(
	workspace: Pick<NormalizedWorkspace, 'stages'>,
	app: MobileAppDeclaration,
	stage: string,
): MobileStage {
	const { deployed } = workspace.stages;
	for (const named of Object.keys(app.stages ?? {})) {
		if (!deployed.includes(named)) {
			throw new MobileAppStageUndeclared(app.id, named, deployed);
		}
	}

	const users = workspace.stages.protected?.includes(stage) ?? false;
	const given = app.stages?.[stage];
	return {
		stage,
		environment: given?.environment ?? (users ? 'production' : 'preview'),
		channel: stage,
		android: {
			track: given?.android?.track ?? (users ? 'production' : 'internal'),
			releaseStatus: given?.android?.releaseStatus ?? 'draft',
		},
	};
}
