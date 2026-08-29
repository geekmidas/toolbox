import { dynamic, type Input, type Output } from '@pulumi/pulumi';

/**
 * A Dokploy application, as a Pulumi resource.
 *
 * **A prototype, and the point of it is the shape rather than the coverage.**
 * One resource, to see whether wrapping Dokploy's REST API in a dynamic provider
 * is worth doing for the rest — because if it is, a whole subsystem goes away.
 *
 * ## Why this is worth trying
 *
 * `packages/cli/src/deploy/` is a deployment engine written by hand: it calls
 * the API, and it remembers what it created in `deploy/state.ts` and
 * `SSMStateProvider` so the next deploy can find the same resources. That second
 * half is the interesting one, because *remembering what you created* is the
 * entire job of a Pulumi state file. A provider does not need it.
 *
 * What else falls out: `pulumi preview` starts working for the server target,
 * and `fromManifest` becomes one shape across both targets — a table of
 * provisioners — rather than an SST adapter beside a bespoke engine.
 *
 * ## Why it is a dynamic provider and not a real one
 *
 * A real Pulumi provider is a plugin binary with a schema, usually generated
 * from a Terraform provider that does not exist here. A dynamic provider is a
 * TypeScript object with `create`/`read`/`update`/`delete`, running in-process
 * during the deploy. SST itself uses this exact escape hatch wherever official
 * coverage stops — `vercel/providers/dns-record.ts`,
 * `cloudflare/providers/kv-data.ts` — which is the precedent worth leaning on.
 *
 * ## The three things that make it risky
 *
 * 1. **The provider is serialised into state.** Pulumi captures the functions
 *    below and stores them, so they must be self-contained — no reaching for an
 *    import from the surrounding module at call time. That is why the API token
 *    is an *input* rather than something closed over, and why `fetch` is used
 *    directly instead of `DokployApi`, which would have to serialise with it.
 * 2. **`delete` runs on destroy, and orphans are silent.** Today's engine fails
 *    loudly when it cannot find something; a provider that gets destroy wrong
 *    leaves resources behind that Pulumi believes it removed. This is the half
 *    to be most careful with, and the reason a prototype exists at all.
 * 3. **`diff` is yours.** Without it, preview cannot say what a change will do —
 *    which is one of the main reasons for doing this.
 *
 * ## Not verified
 *
 * No Dokploy instance has run this. The shape type-checks and the decisions are
 * assertable; nothing has been created or destroyed against a real server.
 */

interface ApplicationInputs {
	/** Where the Dokploy server answers, e.g. `https://dokploy.example.com`. */
	endpoint: string;
	/**
	 * The API token.
	 *
	 * An input rather than a captured variable, because the provider's functions
	 * are serialised into state and a closure over module scope does not survive
	 * that. SST's own dynamic providers pass credentials the same way.
	 */
	apiToken: string;
	name: string;
	projectId: string;
	environmentId: string;
}

interface ApplicationOutputs extends ApplicationInputs {
	applicationId: string;
	appName: string;
}

/**
 * Dokploy's app name rule, applied where the name is decided.
 *
 * The existing client does this inline at the create call; here it is a function
 * because `diff` has to ask whether a *changed* name produces a changed app
 * name, and duplicating the expression is how those two answers drift apart.
 */
export function appNameFor(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * What a change costs — pure, so preview's behaviour can be asserted without a
 * Dokploy server.
 *
 * The name is the interesting one: Dokploy derives `appName` from it, and
 * changing that is not an update but a different application, so the old one has
 * to go. Saying so here is what makes `pulumi preview` warn *before* the
 * destroy rather than reporting it after.
 */
export function diffApplication(
	olds: { name: string; projectId: string; environmentId: string },
	news: { name: string; projectId: string; environmentId: string },
): { changes: boolean; replaces: string[]; deleteBeforeReplace: boolean } {
	const replaces: string[] = [];

	if (appNameFor(olds.name) !== appNameFor(news.name)) replaces.push('name');
	if (olds.projectId !== news.projectId) replaces.push('projectId');
	if (olds.environmentId !== news.environmentId) replaces.push('environmentId');

	return {
		changes: replaces.length > 0 || olds.name !== news.name,
		replaces,
		// Create the replacement before removing the old one. A Dokploy project
		// can hold both for a moment; it cannot hold a gap where the application
		// used to be.
		deleteBeforeReplace: false,
	};
}

const provider: dynamic.ResourceProvider<
	ApplicationInputs,
	ApplicationOutputs
> = {
	async create(inputs) {
		const application = await call<{
			applicationId: string;
			appName: string;
		}>(inputs, 'application.create', {
			name: inputs.name,
			projectId: inputs.projectId,
			environmentId: inputs.environmentId,
			appName: appNameFor(inputs.name),
		});

		return {
			// Pulumi's own id for the resource. Using Dokploy's makes the two
			// agree, so a state file read by a human names the same thing the
			// Dokploy UI does.
			id: application.applicationId,
			outs: { ...inputs, ...application },
		};
	},

	/**
	 * Refresh from the server.
	 *
	 * Returning no id is how a provider says "this is gone", which is what
	 * lets `pulumi refresh` notice something deleted in the Dokploy UI rather
	 * than failing on the next update against a resource that is not there.
	 */
	async read(id, props) {
		const application = await call<{
			applicationId: string;
			appName: string;
		} | null>(
			props as ApplicationInputs,
			`application.one?applicationId=${id}`,
			undefined,
		);

		if (!application) return { id: undefined };

		return { id, props: { ...(props as ApplicationOutputs), ...application } };
	},

	/**
	 * What a change costs.
	 *
	 * The name is the interesting one: Dokploy derives `appName` from it, and
	 * changing that is not an update — it is a different application, so the
	 * old one has to go. Saying so here is what makes `pulumi preview` warn
	 * before the destroy rather than after.
	 */
	async diff(_id, olds, news) {
		return diffApplication(olds, news);
	},

	async update(id, _olds, news) {
		await call(news, 'application.update', {
			applicationId: id,
			name: news.name,
		});

		return {
			outs: { ...news, applicationId: id, appName: appNameFor(news.name) },
		};
	},

	/**
	 * Remove it, and treat "already gone" as success.
	 *
	 * A destroy that fails because somebody removed the application by hand
	 * leaves the stack unable to make progress, which is worse than the thing
	 * it is protecting against — the resource is absent either way, which is
	 * what was asked for.
	 */
	async delete(id, props) {
		try {
			await call(props, 'application.remove', { applicationId: id });
		} catch (error) {
			if (!isNotFound(error)) throw error;
		}
	},
};

/**
 * One call to Dokploy.
 *
 * Written out rather than reusing `DokployApi` because the provider's functions
 * are serialised into state: a class imported from another module would have to
 * serialise too, and the failure when it cannot is obscure. `fetch` is a global.
 */
async function call<T>(
	auth: { endpoint: string; apiToken: string },
	path: string,
	body?: Record<string, unknown>,
): Promise<T> {
	const response = await fetch(`${auth.endpoint}/api/trpc/${path}`, {
		method: body ? 'POST' : 'GET',
		headers: {
			'x-api-key': auth.apiToken,
			'content-type': 'application/json',
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		throw new Error(
			`Dokploy ${path} failed: ${response.status} ${response.statusText}${
				detail ? ` — ${detail}` : ''
			}`,
		);
	}

	return (await response.json()) as T;
}

/** Whether an error means the thing is already absent. */
function isNotFound(error: unknown): boolean {
	return error instanceof Error && /\b404\b/.test(error.message);
}

export interface ApplicationArgs {
	endpoint: Input<string>;
	apiToken: Input<string>;
	name: Input<string>;
	projectId: Input<string>;
	environmentId: Input<string>;
}

export class Application extends dynamic.Resource {
	declare readonly applicationId: Output<string>;
	declare readonly appName: Output<string>;

	constructor(name: string, args: ApplicationArgs, opts?: object) {
		super(
			provider,
			name,
			// The outputs have to be declared as undefined inputs or Pulumi will
			// not populate them — a quiet rule, and the usual first thing to get
			// wrong with a dynamic provider.
			{ ...args, applicationId: undefined, appName: undefined },
			opts,
		);
	}
}
