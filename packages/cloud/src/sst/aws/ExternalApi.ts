import { externalApiUrl } from '@geekmidas/manifest';
import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `ExternalApi` — the infra half of the `external-api` kind.
 *
 * Nothing is provisioned: the API is somebody else's. What this holds is the
 * two facts a function needs to call it on this stage — the URL the
 * declaration names for it, and the credentials the provider issued, kept as
 * an SST secret and set out of band:
 *
 * ```
 * sst secret set PolarCredentials '{"clientId":"…","clientSecret":"…"}' --stage prod
 * ```
 */
export class ExternalApi<
	TStage extends string = string,
	TDomain extends string = string,
> implements GkmLinkable
{
	readonly _id: string;

	private readonly url: string;

	private readonly credentials: sst.Secret;

	get _type() {
		return ResourceType.ExternalApi;
	}

	constructor(
		stack: StackType<TStage, TDomain>,
		name: string,
		props: ExternalApiProps,
	) {
		this._id = name;
		// Read at synth, so a stage the declaration has no URL for fails the
		// deploy — with the stage named — rather than the first request.
		this.url = externalApiUrl({ id: name, url: props.url }, stack.stage);
		this.credentials = new sst.Secret(`${name}Credentials`, props.placeholder);
	}

	provides(): Record<string, $util.Input<string>> {
		return { url: this.url, credentials: this.credentials.value };
	}

	getSSTLink() {
		return { properties: { ...this.provides() } };
	}
}

export interface ExternalApiProps {
	/** The declaration's `url` — one for every stage, or one per stage name. */
	url: string | Readonly<Record<string, string>>;
	/** A value for the credentials secret until one is set, for a preview stage. */
	placeholder?: string;
}
