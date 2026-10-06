/**
 * An image reference, checked before it reaches `docker`.
 *
 * The parts come from the workspace — a registry in `gkm.config.ts`, an image
 * name from the project, a tag from `--tag` — and an argument array already
 * keeps them out of a shell. What it cannot do is stop `docker` reading a value
 * that starts with `-` as one of its own flags, so a ref is held to Docker's
 * own grammar (distribution/reference) and anything else is refused by name
 * before a build starts.
 */

const DOMAIN_COMPONENT = '(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])';
const DOMAIN = `${DOMAIN_COMPONENT}(?:\\.${DOMAIN_COMPONENT})*(?::[0-9]+)?`;
const PATH_COMPONENT = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*';
const TAG = '[\\w][\\w.-]{0,127}';
const DIGEST =
	'[A-Za-z][A-Za-z0-9]*(?:[-_+.][A-Za-z][A-Za-z0-9]*)*:[0-9a-fA-F]{32,}';

const REFERENCE = new RegExp(
	`^(?:${DOMAIN}/)?${PATH_COMPONENT}(?:/${PATH_COMPONENT})*(?::${TAG})?(?:@${DIGEST})?$`,
);

/** Docker refuses a repository name longer than this. */
const MAX_NAME_LENGTH = 255;

/** A value that is not an image reference was about to be built or pushed. */
export class ImageRefInvalid extends Error {
	constructor(readonly ref: string) {
		super(
			`'${ref}' is not a valid image reference. An image is \`[registry/]name[:tag]\`: the name lowercase letters, digits and . _ - separators, the tag up to 128 of letters, digits, _ . and -, not starting with . or -. Check docker.registry in gkm.config.ts and the --tag passed.`,
		);
		this.name = 'ImageRefInvalid';
	}
}

/** Throw {@link ImageRefInvalid} unless `ref` is a Docker image reference. */
export function validateImageRef(ref: string): string {
	const name = ref.split('@')[0]!.replace(/:[\w][\w.-]*$/, '');
	if (!REFERENCE.test(ref) || name.length > MAX_NAME_LENGTH) {
		throw new ImageRefInvalid(ref);
	}
	return ref;
}
