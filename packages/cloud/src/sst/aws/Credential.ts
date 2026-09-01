import { Secret, type SecretProps } from './Secret';

/**
 * `Credential` — a third-party credential SST holds, and the infra half of the
 * `credential` kind.
 *
 * The *same storage* as a secret and a different kind, because what differs is
 * the lifecycle rather than the mechanism: a secret is generated and rotated by
 * the platform, while a credential is issued by someone else and has a shape
 * the construct validates on the way in. Both are values you set out of band
 * with `sst secret set`.
 *
 * The role is `credential` rather than `value`, and that is not cosmetic. The
 * role *is* the contract — `providedKeyFor` turns it into the key the app
 * declared — so a credential providing `value` would supply `STRIPE_VALUE`
 * against a declared `STRIPE_CREDENTIAL`, and `assertProvides` would reject the
 * stack at synth. Which is the check working; renaming here is the fix.
 */
export class Credential<
	TStage extends string = string,
	TDomain extends string = string,
> extends Secret<TStage, TDomain> {
	override provides(): Record<string, $util.Input<string>> {
		return { credential: this.value };
	}
}

export interface CredentialProps extends SecretProps {}
