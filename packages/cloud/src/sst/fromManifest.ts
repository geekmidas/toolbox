/**
 * Manifest → SST.
 *
 * Split deliberately into decisions and instantiation. The decisions —
 * which component provisions a kind, whether what it supplies matches what the
 * app declared — are pure functions, so they can be asserted as data. Only
 * {@link fromManifest} touches Pulumi, and it is thin enough that little is
 * hidden behind a runtime nothing can unit-test.
 *
 * Built for AWS. Extending to another provider means adding entries to
 * {@link PROVISIONERS}, not restructuring: the manifest names a *kind*, never a
 * cloud.
 */

import type {
	ConstructManifest,
	Declaration,
	DeclarationKind,
} from '@geekmidas/manifest';
import { ObjectStorage } from './aws/ObjectStorage';
import { ProvidesMismatch, UnknownDeclarationKind } from './errors';
import type { GkmLinkable } from './Linkable';
import type { StackType } from './Stack';

/**
 * A provisioned construct.
 *
 * The component *is* the linkable — `link: [bucket]` takes the component
 * itself — so this extends `GkmLinkable` rather than wrapping one. One edge
 * yields two things from the same object: `link` grants the IAM and carries the
 * resource's properties, `provides()` shapes them into the keys the app
 * declared.
 */
export interface Provisioned extends GkmLinkable {
	provides(): Record<string, $util.Input<string>>;
}

/** Everything the manifest declared, keyed by id — the shape edges resolve against. */
export type ProvisionedManifest = Record<string, Provisioned>;

type Provisioner = (
	stack: StackType,
	declaration: Declaration,
	props: Record<string, unknown>,
) => Provisioned;

/**
 * Provider-specific props, per construct id.
 *
 * Neutral options — `versioned`, and later `cdn` — travel in the declaration,
 * because the app legitimately has an opinion about them. Anything with S3 in
 * its name does not belong in application code, so lifecycle rules, CORS, and
 * canned ACLs are supplied here, in the deploy layer, keyed by the id they
 * apply to and typed against the component that receives them.
 *
 * A third escape hatch needs no API at all: `fromManifest` returns the
 * components, so `provisioned.Uploads.nodes.bucket` is reachable for anything
 * neither route covers.
 */
export type ComponentOverrides = Record<string, Record<string, unknown>>;

/**
 * Which component provisions which kind.
 *
 * The extension point: a second provider adds entries here, and nothing above
 * this line changes.
 */
const PROVISIONERS: Partial<Record<DeclarationKind, Provisioner>> = {
	objects: (stack, d, props) =>
		new ObjectStorage(stack, d.id, {
			// Neutral options the app declared, mapped to this provider's words.
			...(d.kind === 'objects' && d.versioned ? { versioning: true } : {}),
			// Overrides win: they are the more specific statement, and the escape
			// hatch is worthless if it cannot override the general case.
			...props,
		}),
};

/** The provisioner for a kind. Pure — the lookup is testable without Pulumi. */
export function provisionerFor(kind: DeclarationKind): Provisioner {
	const provisioner = PROVISIONERS[kind];
	if (!provisioner) {
		throw new UnknownDeclarationKind(kind, Object.keys(PROVISIONERS));
	}
	return provisioner;
}

/**
 * Assert that infra supplies exactly what the app declared.
 *
 * The app↔infra contract is the one guarantee spanning two packages, two build
 * phases, and two authors, and the one a JavaScript consumer gets no compiler
 * help with — so it is checked at synth rather than trusted. Pure, and the
 * reason this is a separate function.
 */
export function assertProvides(
	id: string,
	declared: readonly string[] = [],
	supplied: readonly string[] = [],
): void {
	const missing = declared.filter((key) => !supplied.includes(key));
	const extra = supplied.filter((key) => !declared.includes(key));

	if (missing.length || extra.length) {
		throw new ProvidesMismatch(id, missing, extra);
	}
}

/**
 * Provision everything the manifest declares.
 *
 * Resources are leaves — they depend on nothing — so order within this pass is
 * free. Constructs that derive from another (a read replica, a schema tenant)
 * name their parent and are resolved after it; none exist yet.
 */
export function fromManifest(
	stack: StackType,
	manifest: ConstructManifest,
	overrides: ComponentOverrides = {},
): ProvisionedManifest {
	const provisioned: ProvisionedManifest = {};

	for (const [id, declaration] of Object.entries(manifest)) {
		const component = provisionerFor(declaration.kind)(
			stack,
			declaration,
			overrides[id] ?? {},
		);

		assertProvides(id, declaration.provides, Object.keys(component.provides()));

		provisioned[id] = component;
	}

	return provisioned;
}
