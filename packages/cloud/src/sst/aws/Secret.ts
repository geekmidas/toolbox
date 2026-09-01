import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `Secret` — a linkable SST secret, and the infra half of the `secret` kind.
 *
 * The odd one among the kinds: it provisions no cloud resource of its own. An
 * SST secret is a value held in the app's own encrypted state and set out of
 * band (`sst secret set AuthSecret …`), which is why the component is thin and
 * why the *deploy* fails rather than the *runtime* when nobody set one — SST
 * raises `SecretMissingError` at synth, which is the earliest anything can.
 *
 * It provides a value rather than an address, which is the whole reason it is a
 * node instead of a field on whatever needs it: the thing that generates a
 * signing key, the thing that stores it, and the thing that reads it are three
 * different systems deployed, and one derived string locally.
 *
 * Usable on its own. `Stack.fromManifest` translates a manifest into these, but
 * the component takes an ordinary placeholder so it works in a hand-written
 * `sst.config.ts` with no manifest anywhere.
 */
export class Secret<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.Secret
	implements GkmLinkable
{
	readonly _id!: string;

	get _type() {
		return ResourceType.SSTSecret;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: SecretProps = {},
	) {
		super(name, props.placeholder);
		this._id = name;
	}

	/**
	 * The one value this secret resolves onto anything that depends on it.
	 *
	 * `value` is the role, so `provideKey` turns it into the key the app
	 * declared. Note that a secret's key is its *name* rather than
	 * `<NAME>_VALUE` — `Auth` signs with `AUTH_SECRET`, which is also what
	 * better-auth's own tooling looks for — so the manifest declares that key
	 * directly and this contributes the value behind it.
	 */
	provides(): Record<string, $util.Input<string>> {
		return { value: this.value };
	}

	override getSSTLink() {
		const link = super.getSSTLink();
		return {
			...link,
			properties: { ...link.properties, ...this.provides() },
		};
	}
}

export interface SecretProps {
	/**
	 * A value to fall back to when none is set.
	 *
	 * Deliberately not a default for anything that signs: a placeholder signing
	 * key is one every deploy of every app shares, so leaving this unset — and
	 * letting the deploy fail — is the correct handling for a real secret. It
	 * exists for the values that are secrets by habit rather than by need.
	 */
	placeholder?: string;
}
