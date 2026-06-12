import { ResourceType } from '@geekmidas/envkit/sst';

export { ResourceType };

/**
 * A linkable resource: an SST component carrying a stable `_id` (its name, used
 * as the environment-variable prefix) and a `_type` drawn from the shared
 * `ResourceType` vocabulary in `@geekmidas/envkit/sst`. The same `_type` values
 * drive the runtime resolvers, so a linked resource resolves to predictable
 * environment variables — and can be validated before deploy (see the validation
 * model in `packages/cloud/docs/sst-constructs.md`).
 *
 * `_type` is the infra-time analogue of the runtime resource's `type`; the Api
 * construct bridges the two when validating (`{ [_id]: { type: _type } }`).
 */
export interface GkmLinkable {
	readonly _id: string;
	readonly _type: ResourceType;
}
