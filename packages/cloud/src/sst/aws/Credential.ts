import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `Credential` — a third-party credential SST holds, and the infra half of the
 * `credential` kind.
 *
 * The *same storage* as a secret and a different kind, because what differs is
 * the lifecycle rather than the mechanism: a secret is generated and rotated by
 * the platform, while a credential is issued by someone else and has a shape
 * the construct validates on the way in. Both are values you set out of band
 * with `sst secret set`, under the construct's id.
 *
 * The role is `credentials` rather than `value`, and that is not cosmetic. The
 * role *is* the contract — `providedKeyFor` turns it into the key the app
 * declared — so a credential providing `value` would supply `STRIPE_VALUE`
 * against a declared `STRIPE_CREDENTIALS`, and `assertProvides` would reject
 * the stack at synth.
 *
 * It holds an `sst.Secret` rather than being one, and reports its own type,
 * for the same reason one level down: the type decides the keys a link
 * resolves to. As an SST secret it resolved to `STRIPE`, so a function that
 * declared `STRIPE_CREDENTIALS` was linked to nothing.
 */
export class Credential<
	TStage extends string = string,
	TDomain extends string = string,
> implements GkmLinkable
{
	readonly _id: string;

	private readonly secret: sst.Secret;

	get _type() {
		return ResourceType.Credential;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: CredentialProps = {},
	) {
		this._id = name;
		// The id itself, as it always was: a value already set with
		// `sst secret set Stripe …` is still the one read.
		this.secret = new sst.Secret(name, props.placeholder);
	}

	provides(): Record<string, $util.Input<string>> {
		return { credentials: this.secret.value };
	}

	getSSTLink() {
		return { properties: { ...this.provides() } };
	}
}

export interface CredentialProps {
	/** A value until one is set, for a preview stage. */
	placeholder?: string;
}
