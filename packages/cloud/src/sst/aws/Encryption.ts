import { kmsUrl } from '@geekmidas/manifest';
import { kms } from '@pulumi/aws';
import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `Encryption` — two KMS keys, and the infra half of the `encryption` kind.
 *
 * One key encrypts, by envelope: each value is sealed with a data key KMS
 * mints and wraps, so the key itself never leaves KMS. It rotates yearly, and
 * KMS keeps every version it rotated through, so nothing written is ever
 * stranded. The other is an HMAC key for the blind index, which does not
 * rotate — a rotated index key would make every stored index miss.
 *
 * Both are reached through one `kms://` URL, and a function linked to this is
 * granted exactly the calls the cipher makes on exactly these two keys. Not
 * `kms:*`, and not any other key in the account.
 *
 * It holds the keys rather than being one, and reports its own type, so a link
 * resolves to `<ID>_URL` — the key the construct declared.
 */
export class Encryption<
	TStage extends string = string,
	TDomain extends string = string,
> implements GkmLinkable
{
	readonly _id: string;

	readonly key: kms.Key;
	readonly indexKey: kms.Key;
	private readonly region: string;

	get _type() {
		return ResourceType.Encryption;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: EncryptionProps,
	) {
		this._id = name;
		this.region = props.region;

		this.key = new kms.Key(`${name}Key`, {
			description: `${name}: encrypts what the application stores`,
			enableKeyRotation: true,
			deletionWindowInDays: props.deletionWindowInDays ?? 30,
		});
		this.indexKey = new kms.Key(`${name}IndexKey`, {
			description: `${name}: the blind index's HMAC key`,
			keyUsage: 'GENERATE_VERIFY_MAC',
			customerMasterKeySpec: 'HMAC_256',
			deletionWindowInDays: props.deletionWindowInDays ?? 30,
		});
	}

	provides(): Record<string, $util.Input<string>> {
		return {
			url: $util
				.all([this.key.arn, this.indexKey.arn])
				.apply(([key, index]) => kmsUrl({ region: this.region, key, index })),
		};
	}

	getSSTLink() {
		return {
			properties: { ...this.provides() },
			include: [
				sst.aws.permission({
					actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
					resources: [this.key.arn],
				}),
				sst.aws.permission({
					actions: ['kms:GenerateMac'],
					resources: [this.indexKey.arn],
				}),
			],
		};
	}
}

export interface EncryptionProps {
	/** Where the keys live — the stage's region. */
	region: string;
	/**
	 * How long a deleted key can still be recovered, 7–30 days. A key's
	 * deletion is the deletion of everything it encrypted, so the longest.
	 */
	deletionWindowInDays?: number;
}
