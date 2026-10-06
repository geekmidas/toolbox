/**
 * Which image each app runs — and, for a tag, whether every one exists.
 *
 * A tag is a release's identity: `--tag=v1.4.0` means the images CI pushed as
 * v1.4.0, and nothing else. So a stack is never half rolled out: every app's
 * image is asked of the registry before anything is pulled or the running
 * stack is touched, and one missing image stops the whole run naming every
 * one that is missing. Nor is a missing image quietly built instead — a build
 * of whatever is checked out here is not the release the tag names.
 */

import type { ComposeDocker } from './docker';

/** One app's image, as the stack runs it. */
export interface AppImage {
	app: string;
	ref: string;
	tag: string;
}

/**
 * The tag a site's image carries for a release.
 *
 * A site's public URLs are inlined when it is built, so one bundle serves one
 * stage: `v1.4.0-production` and `v1.4.0-staging` are two images of the same
 * commit. A backend reads its URLs at runtime, so one image serves every stage
 * and its tag is the release's alone.
 */
export function siteTag(tag: string, stage: string): string {
	return `${tag}-${stage}`;
}

/** Images a tag names that the registry does not have. */
export class ImageTagNotFound extends Error {
	constructor(
		readonly tag: string,
		readonly refs: readonly string[],
	) {
		super(
			`The registry has no image for ${refs.length === 1 ? 'this app' : `${refs.length} apps`} at '${tag}':\n` +
				refs.map((ref) => `  - ${ref}`).join('\n') +
				`\nNothing was pulled or started. Push '${tag}' for every app from CI, ` +
				`pick a tag that exists, or run without --tag to build from this checkout.`,
		);
		this.name = 'ImageTagNotFound';
	}
}

/** The registry did not answer, or did not let this machine in. */
export class RegistryUnreachable extends Error {
	constructor(
		readonly ref: string,
		readonly detail: string,
	) {
		super(
			`Could not ask the registry about ${ref}: ${detail || 'no answer'}\n` +
				`Nothing was pulled or started. Check the registry is reachable and ` +
				`that this machine is logged in to it (\`docker login <registry>\`).`,
		);
		this.name = 'RegistryUnreachable';
	}
}

/**
 * Assert every image exists, before anything else happens.
 *
 * Asked all at once and reported all at once: a release missing two images is
 * one problem with two names, and finding the second only after fixing the
 * first is a slower way to learn the same thing.
 *
 * @throws {RegistryUnreachable} when the registry cannot say
 * @throws {ImageTagNotFound} listing every missing image
 */
export async function assertImagesExist(
	docker: Pick<ComposeDocker, 'lookup'>,
	tag: string,
	images: readonly AppImage[],
): Promise<void> {
	const lookups = await Promise.all(
		images.map((image) => docker.lookup(image.ref)),
	);

	const unreachable = lookups.find((lookup) => lookup.status === 'unreachable');
	if (unreachable?.status === 'unreachable') {
		throw new RegistryUnreachable(unreachable.ref, unreachable.detail);
	}

	const missing = lookups
		.filter((lookup) => lookup.status === 'missing')
		.map((lookup) => lookup.ref);
	if (missing.length > 0) throw new ImageTagNotFound(tag, missing);
}
