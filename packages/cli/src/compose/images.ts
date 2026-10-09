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

import { GkmError } from '../errors';
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
export class ImageTagNotFound extends GkmError {
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
export class RegistryUnreachable extends GkmError {
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

/**
 * A push or a pull with no `deploy.registry` to push to or pull from.
 *
 * Without one an image is named `<namespace>/<project>-<app>:<tag>`, which
 * Docker resolves to Docker Hub — so a release would be pushed to, or pulled
 * from, somebody else's account. It is never a fallback.
 */
export class RegistryRequired extends GkmError {
	constructor(
		/** What needed the registry: `--push`, or a pull (`--tag`/`--pull`). */
		readonly operation: 'push' | 'pull',
		/** The ref an image would have had: a Docker Hub name. */
		readonly ref: string,
	) {
		super(
			`${operation === 'push' ? 'Pushing' : 'Pulling'} images needs a registry, and gkm.config.ts sets no deploy.registry: ` +
				`'${ref}' would be ${operation === 'push' ? 'pushed to' : 'pulled from'} Docker Hub. ` +
				`Set deploy.registry (e.g. registry: 'ghcr.io/acme') in gkm.config.ts.` +
				(operation === 'pull'
					? ' To run images built here instead, pass --build.'
					: ''),
		);
		this.name = 'RegistryRequired';
	}
}

/**
 * What a push reports, and what a pull can pin to: each app's image as
 * `<ref>@sha256:…` — the tag it was pushed as, and the exact image, whatever
 * that tag is later moved to.
 */
export type ImageDigests = Record<string, string>;

/** An image pinned to its digest: `<ref>@sha256:…`. */
export function pinnedRef(ref: string, digest: string): string {
	return `${ref.split('@')[0]}@${digest}`;
}

/** A digests file with no entry for an app the stack runs. */
export class ImageDigestMissing extends GkmError {
	constructor(
		readonly file: string,
		readonly apps: readonly string[],
	) {
		super(
			`${file} pins no digest for ${apps.join(', ')}. Use the file the ` +
				`same release's \`gkm compose --build --push --digests-file\` wrote, ` +
				`or run without --digests-file to pull by tag.`,
		);
		this.name = 'ImageDigestMissing';
	}
}

/** A digests file entry that is not this app's image. */
export class ImageDigestMismatch extends GkmError {
	constructor(
		readonly app: string,
		readonly expected: string,
		readonly found: string,
	) {
		super(
			`The digests file pins '${app}' to ${found}, but this release runs ` +
				`${expected}. It was written for another registry, project, stage ` +
				`or tag; use the file this stage's push of this tag wrote.`,
		);
		this.name = 'ImageDigestMismatch';
	}
}

/** A digests file that is not a JSON object of app to pinned ref. */
export class ImageDigestsInvalid extends GkmError {
	constructor(
		readonly file: string,
		readonly detail: string,
	) {
		super(
			`${file} is not a digests file (${detail}). It should be the JSON ` +
				`object \`gkm compose --build --push --digests-file\` writes: ` +
				`{ "api": "<registry>/<image>:<tag>@sha256:…" }.`,
		);
		this.name = 'ImageDigestsInvalid';
	}
}

/** Parse a digests file's content, checking its shape. */
export function parseDigests(file: string, content: string): ImageDigests {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error) {
		throw new ImageDigestsInvalid(
			file,
			error instanceof Error ? error.message : String(error),
		);
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new ImageDigestsInvalid(file, 'not a JSON object');
	}
	for (const [app, value] of Object.entries(parsed)) {
		if (typeof value !== 'string' || !/@sha256:[0-9a-f]{64}$/.test(value)) {
			throw new ImageDigestsInvalid(
				file,
				`'${app}' is not an <image>:<tag>@sha256:… ref`,
			);
		}
	}
	return parsed as ImageDigests;
}

/**
 * Each image pinned to the digest the file names for it.
 *
 * @throws {ImageDigestMissing} naming every app the file has no entry for
 * @throws {ImageDigestMismatch} when an entry is another image or tag
 */
export function pinImages<T extends AppImage>(
	file: string,
	digests: ImageDigests,
	images: readonly T[],
): T[] {
	const missing = images
		.filter((image) => !digests[image.app])
		.map((image) => image.app);
	if (missing.length > 0) throw new ImageDigestMissing(file, missing);

	return images.map((image) => {
		const pinned = digests[image.app]!;
		if (pinned.split('@')[0] !== image.ref) {
			throw new ImageDigestMismatch(image.app, image.ref, pinned);
		}
		return { ...image, ref: pinned };
	});
}
