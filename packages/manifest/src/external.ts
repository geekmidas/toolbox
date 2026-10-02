import type { ExternalApiDeclaration } from './declaration';

/** The key in a by-stage `url` that answers for every stage not listed. */
export const DEFAULT_STAGE_URL = 'default';

/**
 * Where an external API answers on a deployed stage.
 *
 * One URL answers every stage; a record answers by stage name, falling back
 * to `default`. Read at build and deploy, so a stage nobody gave a URL fails
 * there — with the stage named — rather than at the first request.
 *
 * @throws {NoUrlForStage} when a record names neither the stage nor a default.
 */
export function externalApiUrl(
	declaration: Pick<ExternalApiDeclaration, 'id' | 'url'>,
	stage: string,
): string {
	const { url } = declaration;
	if (typeof url === 'string') return url;

	const resolved = url[stage] ?? url[DEFAULT_STAGE_URL];
	if (!resolved) {
		throw new NoUrlForStage(declaration.id, stage, Object.keys(url));
	}

	return resolved;
}

/** An external API's `url` record has nothing for the stage being deployed. */
export class NoUrlForStage extends Error {
	constructor(
		readonly id: string,
		readonly stage: string,
		readonly stages: readonly string[],
	) {
		super(
			`'${id}' has no URL for the stage '${stage}': its url names ` +
				`${stages.length ? stages.map((s) => `'${s}'`).join(', ') : 'no stages'}. ` +
				`Add '${stage}', or a '${DEFAULT_STAGE_URL}' for every stage not listed.`,
		);
		this.name = 'NoUrlForStage';
	}
}
