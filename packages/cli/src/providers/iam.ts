/**
 * An IAM user gkm creates for one thing on a stage, its inline policy, and
 * the access key written into the stage's secrets as an `s3://` URL — what
 * the `s3` provider gives each bucket, and the deploy gives a stage's
 * backups.
 *
 * - **The user** is under `/gkm/`, tagged with the deploy identity, the stage
 *   and what it is for. One that exists without those tags is someone
 *   else's, and is refused rather than taken over.
 * - **Its policy** is read on every run and put back when it drifted.
 * - **Its key**: one, written into the stage's secrets the moment IAM shows
 *   its secret. `--rotate-keys` issues a successor and keeps the old one
 *   active until the stage has deployed with the new one; the next run after
 *   that — or `--retire-old-keys` — deletes it.
 * - **A new key** takes IAM seconds to become usable: the state records when
 *   it was issued, and a check made with it waits that out
 *   ({@link whileKeyIsNew}).
 */

import * as s3Url from '@geekmidas/storage/s3-url';
import type { ResourceRecord } from '../deploy/StateStore.js';
import {
	AccessKeyLimit,
	BucketKeySetElsewhere,
	IamUserNotOwned,
	RotationInProgress,
} from './s3/errors.js';
import { IAM_USER_PATH } from './s3/naming.js';
import { canonicalPolicy } from './s3/policy.js';
import type { EnsureContext, ProviderConfig, StateEntry } from './types.js';

type IamModule = typeof import('@aws-sdk/client-iam');

/** The tags gkm finds its own buckets and users by. */
export const TAG_PROJECT = 'gkm:project';
export const TAG_STAGE = 'gkm:stage';
export const TAG_CONSTRUCT = 'gkm:construct';

/** What creating a user and its key is done through. */
export interface IamClients {
	IAM: IamModule;
	iam: InstanceType<IamModule['IAMClient']>;
	/** The region the key's URL names. */
	region: string;
	/** An emulator's endpoint, written into the URL when there is one. */
	endpoint?: string;
}

/** What creating a user and its key reads from a provisioning run. */
export type KeyContext = Pick<
	EnsureContext<ProviderConfig, unknown>,
	| 'identity'
	| 'stage'
	| 'state'
	| 'change'
	| 'dryRun'
	| 'secrets'
	| 'writeSecrets'
	| 'rotateKeys'
	| 'retireOldKeys'
	| 'log'
>;

/** The keys gkm tags a bucket and a user with. */
export function identityTags(
	ctx: Pick<KeyContext, 'identity' | 'stage'>,
	id: string,
) {
	return [
		{ Key: TAG_PROJECT, Value: ctx.identity.key },
		{ Key: TAG_STAGE, Value: ctx.stage },
		{ Key: TAG_CONSTRUCT, Value: id },
	];
}

/** A read whose "there is none" answer is one of `missing`. */
async function readOr<T>(
	read: () => Promise<T>,
	missing: readonly string[],
): Promise<T | undefined> {
	try {
		return await read();
	} catch (error) {
		const e = error as { name?: string; Code?: string };
		if (missing.includes(e?.Code ?? e?.name ?? '')) return undefined;
		throw error;
	}
}

/** IAM returns a policy document URL-encoded; an emulator may not. */
function decodePolicy(document: string): string {
	try {
		return decodeURIComponent(document);
	} catch {
		return document;
	}
}

export interface IamUserInput {
	/** What it is for: a bucket construct's id, or `backups`. */
	id: string;
	/** `gkm-<project>-<stage>-<id>`. */
	user: string;
	/** The inline policy's name. */
	policyName: string;
	policy: object;
	/** The policy's change line: `this bucket only`. */
	describe: string;
}

/**
 * The user and its inline policy: found — and refused when it is not this
 * stage's — or created, and the policy put back when it drifted.
 *
 * @throws {IamUserNotOwned}
 */
export async function ensureIamUser(
	ctx: KeyContext,
	clients: IamClients,
	input: IamUserInput,
): Promise<{ user: string; exists: boolean }> {
	const { IAM, iam } = clients;
	const { id, user, policy } = input;
	const entry: StateEntry = { key: `iam-user:${id}`, type: 'iam-user' };
	const found = await readOr(
		() => iam.send(new IAM.GetUserCommand({ UserName: user })),
		['NoSuchEntity', 'NoSuchEntityException'],
	);

	if (found?.User) {
		const tags = await iam.send(
			new IAM.ListUserTagsCommand({ UserName: user }),
		);
		const tag = (key: string) => tags.Tags?.find((t) => t.Key === key)?.Value;
		if (
			found.User.Path !== IAM_USER_PATH ||
			tag(TAG_PROJECT) !== ctx.identity.key ||
			tag(TAG_STAGE) !== ctx.stage
		) {
			throw new IamUserNotOwned(user, ctx.identity.key, ctx.stage);
		}
		await ctx.state.ready(entry, user);
	} else {
		await ctx.change(
			{
				construct: id,
				resource: `IAM user ${user}`,
				change: `create under ${IAM_USER_PATH}`,
			},
			async () => {
				await ctx.state.pending(entry);
				await iam.send(
					new IAM.CreateUserCommand({
						UserName: user,
						Path: IAM_USER_PATH,
						Tags: identityTags(ctx, id),
					}),
				);
				await ctx.state.ready(entry, user);
			},
		);
	}

	const exists = Boolean(found?.User) || !ctx.dryRun;
	const current = exists
		? await readOr(
				() =>
					iam.send(
						new IAM.GetUserPolicyCommand({
							UserName: user,
							PolicyName: input.policyName,
						}),
					),
				['NoSuchEntity', 'NoSuchEntityException'],
			)
		: undefined;
	const document = current?.PolicyDocument
		? JSON.parse(decodePolicy(current.PolicyDocument))
		: undefined;
	if (!document || canonicalPolicy(document) !== canonicalPolicy(policy)) {
		await ctx.change(
			{
				construct: id,
				resource: `IAM user ${user}`,
				change: `policy ${input.policyName}: ${input.describe}`,
			},
			async () => {
				await iam.send(
					new IAM.PutUserPolicyCommand({
						UserName: user,
						PolicyName: input.policyName,
						PolicyDocument: JSON.stringify(policy),
					}),
				);
			},
		);
	}
	return { user, exists };
}

export interface AccessKeyInput {
	/** What it is for, as {@link IamUserInput.id}. */
	id: string;
	user: string;
	/** Whether the user exists yet — false in a dry run that would create it. */
	exists: boolean;
	/** The bucket the URL addresses. */
	bucket: string;
	/** The secret the URL is written to: `UPLOADS_URL`, `BACKUPS_URL`. */
	urlKey: string;
}

/**
 * The user's access key, in the stage's secrets as the bucket's URL.
 *
 * - First run: one key, written into the stage's secrets.
 * - `--rotate-keys`: a second key, written in place of the first; the first
 *   stays active until the stage has deployed with the second, and the next
 *   run after that deploy — or `--retire-old-keys` — deletes it.
 * - A key the secrets no longer hold (a store emptied by hand): replaced the
 *   same way, since its secret cannot be read back.
 *
 * @throws {BucketKeySetElsewhere} when the secret names another bucket
 * @throws {RotationInProgress} on `--rotate-keys` with the last rotation's old key still active
 * @throws {AccessKeyLimit} when the user has two keys gkm did not record
 */
export async function ensureAccessKey(
	ctx: KeyContext,
	clients: IamClients,
	input: AccessKeyInput,
): Promise<void> {
	const { IAM, iam } = clients;
	const { id, bucket, user, urlKey } = input;
	const entryKey = `iam-access-key:${id}`;
	const record = ctx.state.record(entryKey);

	const given = ctx.secrets[urlKey];
	let inUrl: string | undefined;
	let parsed: s3Url.S3Address | undefined;
	if (given !== undefined) {
		try {
			parsed = s3Url.parse(given);
		} catch {
			parsed = undefined;
		}
		if (parsed?.bucket !== bucket) {
			throw new BucketKeySetElsewhere(
				urlKey,
				bucket,
				parsed?.bucket ?? given.replace(/\/\/[^@]*@/, '//'),
				ctx.stage,
			);
		}
		inUrl = parsed.accessKeyId;
	}

	const listed = input.exists
		? ((
				await iam.send(new IAM.ListAccessKeysCommand({ UserName: user }))
			).AccessKeyMetadata?.map((k) => k.AccessKeyId!) ?? [])
		: [];

	let current = record?.status === 'ready' ? record.id : undefined;
	let previous =
		typeof record?.data?.previous === 'string'
			? record.data.previous
			: undefined;
	const rotatedAt =
		typeof record?.data?.rotatedAt === 'string'
			? record.data.rotatedAt
			: undefined;
	const entry = (data: Record<string, unknown> = {}): StateEntry => ({
		key: entryKey,
		type: 'iam-access-key',
		data: { user, ...data },
	});

	// The old key of a rotation: deleted once the stage deployed after it.
	if (previous && current) {
		const deployed =
			rotatedAt !== undefined &&
			ctx.state.lastDeployedAt !== undefined &&
			ctx.state.lastDeployedAt > rotatedAt;
		if (ctx.retireOldKeys || deployed) {
			const old = previous;
			const keep = current;
			await ctx.change(
				{
					construct: id,
					resource: `IAM user ${user}`,
					change: `delete the rotated-out access key ${old}`,
				},
				async () => {
					if (listed.includes(old)) {
						await iam.send(
							new IAM.DeleteAccessKeyCommand({
								UserName: user,
								AccessKeyId: old,
							}),
						);
					}
					await ctx.state.ready(entry(), keep);
				},
			);
			previous = undefined;
		} else {
			ctx.log(
				`   ${id}: the old access key ${previous} stays active until '${ctx.stage}' is deployed with the new one; the next deploy after that deletes it (or pass --retire-old-keys)`,
			);
		}
	}

	// No record, and the secrets hold a key of this user's: adopt it.
	if (!current && inUrl && listed.includes(inUrl)) {
		await ctx.state.ready(entry(), inUrl);
		current = inUrl;
	}

	const valid =
		current !== undefined && listed.includes(current) && inUrl === current;
	if (valid && !ctx.rotateKeys) {
		// The key is good; the address must name where the bucket is.
		if (parsed && parsed.region !== clients.region) {
			const address = parsed;
			await ctx.change(
				{
					construct: id,
					resource: urlKey,
					change: `name ${clients.region}, the bucket's region (it said ${address.region ?? 'none'})`,
				},
				() =>
					ctx.writeSecrets({
						[urlKey]: s3Url.build({ ...address, region: clients.region }),
					}),
			);
		}
		return;
	}
	if (ctx.rotateKeys && previous) {
		throw new RotationInProgress(id, previous, ctx.stage);
	}

	const outgoing = current && listed.includes(current) ? current : undefined;
	if (listed.length >= 2) throw new AccessKeyLimit(user, listed);

	const why = !current
		? 'create an access key'
		: ctx.rotateKeys
			? 'rotate: issue a new access key'
			: 'issue a new access key (the secrets no longer hold the recorded one)';
	await ctx.change(
		{ construct: id, resource: `IAM user ${user}`, change: why },
		async () => {
			await ctx.state.pending(entry(outgoing ? { previous: outgoing } : {}));
			const created = await iam.send(
				new IAM.CreateAccessKeyCommand({ UserName: user }),
			);
			const key = created.AccessKey!;
			// Into the stage's secrets before anything else: IAM shows a secret
			// once, and a key whose secret is lost is a key to replace.
			await ctx.writeSecrets({
				[urlKey]: s3Url.build({
					bucket,
					region: clients.region,
					...(clients.endpoint
						? { endpoint: clients.endpoint, forcePathStyle: true }
						: {}),
					accessKeyId: key.AccessKeyId!,
					secretAccessKey: key.SecretAccessKey!,
				}),
			});
			// When it was issued: IAM takes seconds to make a new key usable,
			// and the deploy's check waits for one this young.
			const issuedAt = new Date().toISOString();
			await ctx.state.ready(
				entry(
					outgoing
						? { previous: outgoing, rotatedAt: issuedAt, issuedAt }
						: { issuedAt },
				),
				key.AccessKeyId!,
			);
		},
	);
	if (outgoing) {
		ctx.log(
			`   ${urlKey} holds the new key. This deploy moves '${ctx.stage}' onto it; the next deploy after it deletes the old key ${outgoing}`,
		);
	}
}

/** How long a key issued this recently counts as new to IAM. */
const NEW_KEY_WINDOW_MS = 10 * 60 * 1000;

/** The waits between asks while a new key becomes usable: about a minute. */
let newKeyWaits: readonly number[] = [2000, 4000, 8000, 15000, 15000, 15000];

/** For tests: the waits for a new key. Returns the old ones. */
export function useNewKeyWaits(waits: readonly number[]): readonly number[] {
	const previous = newKeyWaits;
	newKeyWaits = waits;
	return previous;
}

/**
 * When the key in a URL was issued, if the stage's state says it was just
 * now — the record of `id`'s key naming that very key.
 */
export function issuedJustNow(
	resources: Readonly<Record<string, ResourceRecord>> | undefined,
	id: string,
	accessKeyId: string,
): string | undefined {
	const record = resources?.[`iam-access-key:${id}`];
	const issuedAt = record?.data?.issuedAt;
	if (record?.id !== accessKeyId || typeof issuedAt !== 'string') {
		return undefined;
	}
	const age = Date.now() - Date.parse(issuedAt);
	return age >= 0 && age < NEW_KEY_WINDOW_MS ? issuedAt : undefined;
}

/**
 * `ask` again, for about a minute, while it is `refused` and the key was
 * issued just now — IAM refuses a key for seconds after making it. Returns
 * the last answer and how long was waited.
 */
export async function whileKeyIsNew<T>(
	first: T,
	options: {
		issuedAt: string | undefined;
		refused: (answer: T) => boolean;
		ask: () => Promise<T>;
		/** Said once, before the first wait. */
		onWait?: () => void;
	},
): Promise<{ answer: T; waited: number }> {
	let answer = first;
	let waited = 0;
	if (!options.issuedAt || !options.refused(answer)) return { answer, waited };
	options.onWait?.();
	for (const wait of newKeyWaits) {
		await new Promise((resolve) => setTimeout(resolve, wait));
		waited += wait;
		answer = await options.ask();
		if (!options.refused(answer)) break;
	}
	return { answer, waited };
}
