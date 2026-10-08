/**
 * What the `s3` provider names a bucket and its IAM user.
 *
 * A bucket name is global across every AWS account, so the good name — the
 * one a person reading the console would guess — is tried first and a random
 * suffix is the fallback for a clash. Whatever name is created is recorded in
 * the stage's state and read back on every later run: a name is never
 * regenerated, because a new name is a new, empty bucket.
 */

import { randomInt } from 'node:crypto';
import { kebabCase } from '@geekmidas/manifest';

/** S3's limit on a bucket name. */
export const BUCKET_NAME_MAX = 63;
/** IAM's limit on a user name. */
export const IAM_USER_NAME_MAX = 64;
/** `-` and six characters: what a clash appends. */
export const SUFFIX_LENGTH = 7;
/** How many suffixed names are tried after the good one. */
export const SUFFIX_ATTEMPTS = 5;

const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A name that S3 would refuse — what the name builder never returns. */
export class InvalidBucketName extends Error {
	constructor(
		readonly bucket: string,
		readonly reason: string,
	) {
		super(
			`'${bucket}' is not a valid S3 bucket name: ${reason}. Rename the ` +
				'construct or set deploy.namespace in gkm.config.ts to something ' +
				'that leaves room for it.',
		);
		this.name = 'InvalidBucketName';
	}
}

/** Lowercase `[a-z0-9-]`, runs of anything else one `-`, no edge dashes. */
function part(value: string): string {
	return kebabCase(value)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * `parts` joined by `-`, shortened to `max` characters by trimming the longest
 * part one character at a time — so a long construct id gives way before a
 * short stage name does, and every part keeps its start.
 */
export function fitParts(parts: readonly string[], max: number): string {
	const kept = parts.map(part).filter(Boolean);
	const length = () =>
		kept.reduce((sum, p) => sum + p.length, 0) + kept.length - 1;
	while (length() > max) {
		let longest = 0;
		for (let i = 1; i < kept.length; i++) {
			if (kept[i]!.length > kept[longest]!.length) longest = i;
		}
		if (kept[longest]!.length <= 1) break;
		kept[longest] = kept[longest]!.slice(0, -1).replace(/-+$/, '');
	}
	return kept.join('-');
}

/** Why `name` is not a valid bucket name, or undefined when it is. */
export function bucketNameProblem(name: string): string | undefined {
	if (name.length < 3 || name.length > BUCKET_NAME_MAX) {
		return `it is ${name.length} characters, and S3 takes 3 to ${BUCKET_NAME_MAX}`;
	}
	if (!/^[a-z0-9-]+$/.test(name)) {
		return 'it may hold only lowercase letters, digits and -';
	}
	if (!/^[a-z0-9].*[a-z0-9]$/.test(name)) {
		return 'it must start and end with a letter or a digit';
	}
	if (name.startsWith('xn--') || name.startsWith('sthree-')) {
		return "it starts with a prefix S3 reserves ('xn--', 'sthree-')";
	}
	if (name.endsWith('-s3alias') || name.endsWith('--ol-s3')) {
		return "it ends with a suffix S3 reserves ('-s3alias', '--ol-s3')";
	}
	return undefined;
}

/** What a bucket is named from. */
export interface BucketNameInput {
	/** The deploy identity's scope: `<namespace>-<project>`, or the project. */
	scope: string;
	stage: string;
	/** The `ObjectStorage` construct's id. */
	id: string;
}

/**
 * The good name: `<namespace>-<project>-<stage>-<bucket id>`, lowercased, no
 * dots, shortened to leave room for a clash's suffix.
 *
 * @throws {InvalidBucketName} when nothing usable is left
 */
export function bucketName(input: BucketNameInput): string {
	const name = fitParts(
		[input.scope, input.stage, input.id],
		BUCKET_NAME_MAX - SUFFIX_LENGTH,
	);
	const problem = bucketNameProblem(name);
	if (problem) throw new InvalidBucketName(name, problem);
	return name;
}

/** Six random `[a-z0-9]` characters. */
export function randomSuffix(random: (max: number) => number = randomInt) {
	let suffix = '';
	for (let i = 0; i < 6; i++) {
		suffix += SUFFIX_ALPHABET[random(SUFFIX_ALPHABET.length)];
	}
	return suffix;
}

/** The good name with a clash's suffix. */
export function suffixedBucketName(good: string, suffix: string): string {
	return `${good}-${suffix}`;
}

/**
 * The IAM user a bucket is reached with on a stage:
 * `gkm-<project>-<stage>-<bucket id>`, at most 64 characters.
 */
export function iamUserName(input: BucketNameInput): string {
	return fitParts(
		['gkm', input.scope, input.stage, input.id],
		IAM_USER_NAME_MAX,
	);
}

/** The path every user gkm creates is under, so it finds its own. */
export const IAM_USER_PATH = '/gkm/';

/** The inline policy each user is given. */
export const IAM_POLICY_NAME = 'gkm-bucket';
