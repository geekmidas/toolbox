/**
 * Play Console, through the Play Developer API (androidpublisher v3): the
 * service account's access to the app, the store listing as code, and a
 * check that the new key can act on the app.
 */

import { createSign } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { PlayTrack } from '@geekmidas/manifest';
import { GkmError } from '../../errors';
import { GoogleApiError, type GoogleClient, googleClient } from './google.js';

export const PLAY =
	'https://androidpublisher.googleapis.com/androidpublisher/v3';
export const PLAY_UPLOAD =
	'https://androidpublisher.googleapis.com/upload/androidpublisher/v3';

/** What Play answers about a package no app in the account has. */
const PACKAGE_MISSING = /packages are not available/i;

/** The app is not in Play Console yet, and Play has no API that makes one. */
export class PlayAppMissing extends GkmError {
	constructor(
		readonly packageName: string,
		readonly developer: string,
	) {
		super(
			`Play Console has no app '${packageName}', and Play has no API that ` +
				`creates one. Create it at https://play.google.com/console/developers/` +
				`${developer}/create-new-app, with ${packageName} as its package, then ` +
				'run this again.',
		);
		this.name = 'PlayAppMissing';
	}
}

/** The new key could not open an edit on the app. */
export class PlayKeyUnverified extends GkmError {
	constructor(
		readonly email: string,
		readonly detail: string,
	) {
		super(
			`The new key for ${email} could not open an edit on the app (${detail}). ` +
				'Its access can take a few minutes to reach Play: run this again shortly.',
		);
		this.name = 'PlayKeyUnverified';
	}
}

/**
 * The app-level permissions the service account needs: releasing to the
 * testing tracks, to production only where a stage submits there, and the
 * store listing where the workspace keeps one.
 */
export function playPermissions(options: {
	tracks: readonly PlayTrack[];
	listing: boolean;
}): string[] {
	return [
		'CAN_MANAGE_TRACK_APKS',
		...(options.tracks.includes('production')
			? ['CAN_MANAGE_PUBLIC_APKS']
			: []),
		...(options.listing ? ['CAN_MANAGE_PUBLIC_LISTING'] : []),
	].sort();
}

interface PlayUser {
	email: string;
	grants?: { packageName: string; appLevelPermissions?: string[] }[];
}

/**
 * The service account in Play Console with exactly `permissions` on the
 * app: invited with the grant in one call — Play refuses a user with no
 * permission, and a grant for a user not yet there — and, already there,
 * its grant made what it should be. Answers what changed.
 *
 * @throws {PlayAppMissing}
 */
export async function ensurePlayAccess(
	client: GoogleClient,
	options: {
		developer: string;
		email: string;
		packageName: string;
		permissions: readonly string[];
	},
): Promise<'invited' | 'granted' | 'updated' | 'unchanged'> {
	const { developer, email, packageName } = options;
	const permissions = [...options.permissions].sort();
	const users = `${PLAY}/developers/${developer}/users`;
	const missing = (error: unknown) =>
		error instanceof GoogleApiError && PACKAGE_MISSING.test(error.detail)
			? new PlayAppMissing(packageName, developer)
			: error;

	// Listing takes no paging: Play says "Pagination is not currently
	// available" unless asked for every user at once.
	const { users: listed = [] } = await client.request<{ users?: PlayUser[] }>(
		'GET',
		`${users}?pageSize=-1`,
	);
	const user = listed.find((candidate) => candidate.email === email);

	if (!user) {
		await client
			.request('POST', users, {
				email,
				grants: [{ packageName, appLevelPermissions: permissions }],
			})
			.catch((error) => {
				throw missing(error);
			});
		return 'invited';
	}

	const grant = user.grants?.find((g) => g.packageName === packageName);
	const grantPath = `${users}/${encodeURIComponent(email)}/grants`;
	if (!grant) {
		await client
			.request('POST', grantPath, {
				packageName,
				appLevelPermissions: permissions,
			})
			.catch((error) => {
				throw missing(error);
			});
		return 'granted';
	}
	const had = [...(grant.appLevelPermissions ?? [])].sort();
	if (had.join() === permissions.join()) return 'unchanged';
	await client.request(
		'PATCH',
		`${grantPath}/${packageName}?updateMask=appLevelPermissions`,
		{ appLevelPermissions: permissions },
	);
	return 'updated';
}

/** A service account key file, as Google writes it. */
export interface ServiceAccountJson {
	client_email: string;
	private_key: string;
	token_uri?: string;
}

/** An access token for the key itself: a signed JWT, exchanged. */
export async function keyToken(key: ServiceAccountJson): Promise<string> {
	const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
	const now = Math.floor(Date.now() / 1000);
	const encode = (value: object) =>
		Buffer.from(JSON.stringify(value)).toString('base64url');
	const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
		iss: key.client_email,
		scope: 'https://www.googleapis.com/auth/androidpublisher',
		aud: tokenUri,
		iat: now,
		exp: now + 600,
	})}`;
	const signature = createSign('RSA-SHA256')
		.update(unsigned)
		.sign(key.private_key)
		.toString('base64url');
	const response = await fetch(tokenUri, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: `${unsigned}.${signature}`,
		}),
	});
	const body = (await response.json().catch(() => ({}))) as {
		access_token?: string;
		error_description?: string;
	};
	if (!response.ok || !body.access_token) {
		throw new PlayKeyUnverified(
			key.client_email,
			body.error_description ?? `token exchange answered ${response.status}`,
		);
	}
	return body.access_token;
}

/**
 * Proof the key and its grant work: as the key, open an edit on the app and
 * discard it — what EAS Submit's first call is.
 *
 * @throws {PlayKeyUnverified}
 */
export async function verifyKey(
	key: ServiceAccountJson,
	packageName: string,
): Promise<void> {
	const client = googleClient(await keyToken(key));
	try {
		const edit = await client.request<{ id: string }>(
			'POST',
			`${PLAY}/applications/${packageName}/edits`,
			{},
		);
		await client.request(
			'DELETE',
			`${PLAY}/applications/${packageName}/edits/${edit.id}`,
		);
	} catch (error) {
		if (error instanceof GoogleApiError) {
			throw new PlayKeyUnverified(key.client_email, error.detail);
		}
		throw error;
	}
}

/** The image kinds Play's listing takes, as fastlane supply names them. */
const IMAGE_TYPES = [
	'icon',
	'featureGraphic',
	'promoGraphic',
	'tvBanner',
	'phoneScreenshots',
	'sevenInchScreenshots',
	'tenInchScreenshots',
	'tvScreenshots',
	'wearScreenshots',
] as const;

/** One locale's listing, read from `store/play/listings/<locale>/`. */
export interface PlayListing {
	language: string;
	title?: string;
	shortDescription?: string;
	fullDescription?: string;
	video?: string;
	/** Each image kind's files, in order. */
	images: Partial<Record<(typeof IMAGE_TYPES)[number], string[]>>;
}

/** The store listing kept beside the app, in fastlane supply's layout. */
export interface PlayStore {
	listings: PlayListing[];
	/** `store/play/data-safety.csv`: Play Console's data safety export. */
	dataSafety?: string;
}

/**
 * `<app>/store/play`, read: undefined where there is none.
 *
 * ```
 * store/play/
 *   data-safety.csv
 *   listings/en-US/title.txt, short_description.txt, full_description.txt, video.txt
 *   listings/en-US/images/icon.png, featureGraphic.png
 *   listings/en-US/images/phoneScreenshots/1.png, 2.png …
 * ```
 */
export function readPlayStore(appDir: string): PlayStore | undefined {
	const root = join(appDir, 'store', 'play');
	if (!existsSync(root)) return undefined;
	const text = (path: string) =>
		existsSync(path) ? readFileSync(path, 'utf8').trim() : undefined;

	const listings: PlayListing[] = [];
	const listingsDir = join(root, 'listings');
	for (const language of existsSync(listingsDir)
		? readdirSync(listingsDir).sort()
		: []) {
		const dir = join(listingsDir, language);
		if (!statSync(dir).isDirectory()) continue;
		const images: PlayListing['images'] = {};
		const imagesDir = join(dir, 'images');
		for (const type of IMAGE_TYPES) {
			const single = ['.png', '.jpg', '.jpeg']
				.map((ext) => join(imagesDir, `${type}${ext}`))
				.find(existsSync);
			const many = join(imagesDir, type);
			const files = single
				? [single]
				: existsSync(many)
					? readdirSync(many)
							.filter((f) => /\.(png|jpe?g)$/i.test(f))
							.sort()
							.map((f) => join(many, f))
					: [];
			if (files.length > 0) images[type] = files;
		}
		const listing: PlayListing = { language, images };
		const title = text(join(dir, 'title.txt'));
		const shortDescription = text(join(dir, 'short_description.txt'));
		const fullDescription = text(join(dir, 'full_description.txt'));
		const video = text(join(dir, 'video.txt'));
		if (title) listing.title = title;
		if (shortDescription) listing.shortDescription = shortDescription;
		if (fullDescription) listing.fullDescription = fullDescription;
		if (video) listing.video = video;
		listings.push(listing);
	}

	const dataSafety = text(join(root, 'data-safety.csv'));
	return { listings, ...(dataSafety ? { dataSafety } : {}) };
}

/**
 * Push the listing through one edit, committed: each locale's text, and each
 * image kind replaced by the files kept. Then the data safety form, which
 * Play takes outside an edit. Answers whether the listing was pushed: an
 * app that has never had an upload may refuse an edit, and that is left for
 * the next run, not failed.
 */
export async function pushPlayStore(
	client: GoogleClient,
	packageName: string,
	store: PlayStore,
): Promise<{ listing: boolean; dataSafety: boolean; reason?: string }> {
	const app = `${PLAY}/applications/${packageName}`;
	let listing = false;
	let reason: string | undefined;
	if (store.listings.length > 0) {
		let edit: { id: string } | undefined;
		try {
			edit = await client.request<{ id: string }>('POST', `${app}/edits`, {});
		} catch (error) {
			if (!(error instanceof GoogleApiError)) throw error;
			reason = error.detail;
		}
		if (edit) {
			const base = `${app}/edits/${edit.id}/listings`;
			for (const entry of store.listings) {
				const { images, ...text } = entry;
				if (text.title || text.shortDescription || text.fullDescription) {
					await client.request('PUT', `${base}/${entry.language}`, text);
				}
				for (const [type, files] of Object.entries(images)) {
					await client.request('DELETE', `${base}/${entry.language}/${type}`);
					for (const file of files ?? []) {
						await client.request(
							'POST',
							`${PLAY_UPLOAD}/applications/${packageName}/edits/${edit.id}/listings/${entry.language}/${type}?uploadType=media`,
							undefined,
							{
								raw: {
									contentType:
										extname(file).toLowerCase() === '.png'
											? 'image/png'
											: 'image/jpeg',
									data: readFileSync(file),
								},
							},
						);
					}
				}
			}
			await client.request('POST', `${app}/edits/${edit.id}:commit`);
			listing = true;
		}
	}

	let dataSafety = false;
	if (store.dataSafety) {
		await client.request('POST', `${app}/dataSafety`, {
			safetyLabels: store.dataSafety,
		});
		dataSafety = true;
	}
	return { listing, dataSafety, ...(reason ? { reason } : {}) };
}

/** What Play Console only takes by hand, for the person to tick off. */
export const PLAY_CONSOLE_CHECKLIST = [
	'App content → Privacy policy: the URL of the published policy',
	'App content → App access: how a reviewer signs in',
	'App content → Ads: whether the app shows ads',
	'App content → Content rating: the questionnaire',
	'App content → Target audience and content',
	'App content → Health apps / Health Connect, where the app reads health data',
	'App content → Sensitive permissions, where the app asks for any',
	'Release → the first upload of a new app, by hand',
];
