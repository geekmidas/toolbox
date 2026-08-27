import { type GkmLinkable, ResourceType } from '../Linkable';
import type { Database } from './Database';

/**
 * The two database kinds that provision nothing: a reader, and a schema tenant.
 *
 * Neither is an AWS resource. A reader is an endpoint the cluster already has,
 * and a tenant is a schema *inside* the parent's database, created by DDL that
 * `gkm` runs rather than by anything Pulumi declares. What they contribute is a
 * URL — a different endpoint, or the same one with a different `search_path` —
 * and the identity that lets an edge point at them.
 *
 * That makes them the first `Provisioned`s that wrap no component. They are
 * still linkable, because a function depending on one still needs its URL
 * injected, and the link is what carries it.
 */
abstract class DerivedDatabase implements GkmLinkable {
	readonly _id: string;

	constructor(
		id: string,
		/**
		 * Public because `fromManifest` walks it: a tenant may derive from another
		 * tenant, and what both ultimately need is the cluster underneath.
		 */
		readonly parent: Database,
	) {
		this._id = id;
	}

	abstract get _type(): ResourceType;
	abstract provides(): Record<string, $util.Input<string>>;

	/**
	 * A link carrying only this node's own URL.
	 *
	 * Deliberately *not* the parent's link. A handler depending on the reader
	 * should receive the reader's URL and no other, which is the same
	 * least-privilege rule edges get everywhere else — inheriting the parent's
	 * properties would hand it the writer's address under a second key.
	 */
	getSSTLink() {
		return { properties: { ...this.provides() } };
	}
}

/**
 * A read-only endpoint on an existing cluster.
 *
 * Nothing is provisioned: `reader` is an endpoint an Aurora cluster has. Where
 * the cluster runs a single instance that endpoint resolves to it, which is safe
 * rather than a silently writable connection behind a name that says reader —
 * read-only is enforced by the role's grants, never by which endpoint was
 * reached.
 */
export class DatabaseReader extends DerivedDatabase {
	constructor(
		id: string,
		parent: Database,
		/**
		 * The read-only role, where one was provisioned.
		 *
		 * Absent under `roles: false`, where there is one credential and it is
		 * the master's — and read-only then holds by convention rather than by
		 * grant, which is exactly why that mode is a downgrade.
		 */
		private readonly role?: { user: string; password: $util.Input<string> },
	) {
		super(id, parent);
	}

	get _type() {
		return ResourceType.SSTPostgres;
	}

	provides(): Record<string, $util.Input<string>> {
		return {
			url: this.parent.urlFor({
				reader: true,
				...(this.role ? { as: this.role } : {}),
			}),
		};
	}
}

/**
 * A second schema in the parent's database, with its own URL.
 *
 * The schema and its role are created by DDL, so what this contributes is the
 * parent's connection pinned to a different `search_path`. Through the codec,
 * because `?search_path=` is not a libpq parameter: a URL carrying it is
 * accepted by every parser, ignored by the server, and produces a database that
 * looks empty.
 */
export class DatabaseSchema extends DerivedDatabase {
	constructor(
		id: string,
		parent: Database,
		private readonly schema: string,
		/** The tenant's runtime role, where one was provisioned. */
		private readonly role?: { user: string; password: $util.Input<string> },
	) {
		super(id, parent);
	}

	get _type() {
		return ResourceType.SSTPostgres;
	}

	provides(): Record<string, $util.Input<string>> {
		return {
			url: this.parent.urlFor({
				schema: this.schema,
				...(this.role ? { as: this.role } : {}),
			}),
		};
	}
}
