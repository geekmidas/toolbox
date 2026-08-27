/**
 * Minimal stand-ins for the globals SST injects.
 *
 * Components extend `sst.aws.*`, which is evaluated when the module loads — so
 * without these, importing a component throws a ReferenceError and nothing in
 * the package is reachable from a test, pure or not.
 *
 * These are deliberately not a Pulumi emulation. They make components
 * *importable*, so the adapter's decisions can be asserted as data. Verifying
 * that real resources are created is a different job, for Pulumi's own mocks or
 * a deploy.
 *
 * The addresses below are shaped like the real ones — an ARN with a region in
 * the fourth field, a queue URL with a host — because `provides()` reads them
 * apart. A stub returning `'stub'` would make those functions importable and
 * still untestable.
 */

const STUB_REGION = 'stub-region';
const STUB_ACCOUNT = '123456789012';

class StubComponent {
	readonly name: string;
	readonly nodes: { bucket: { region: string } };

	constructor(name: string, _props?: unknown) {
		this.name = name;
		this.nodes = { bucket: { region: STUB_REGION } };
	}

	/** Shaped like a real ARN: `provides()` reads the region out of field four. */
	get arn() {
		return `arn:aws:sqs:${STUB_REGION}:${STUB_ACCOUNT}:${this.name}`;
	}

	get url() {
		return `https://sqs.${STUB_REGION}.amazonaws.com/${STUB_ACCOUNT}/${this.name}`;
	}

	/** Components override this to widen the payload; the base supplies a name. */
	getSSTLink() {
		return { properties: { name: this.name }, include: [] };
	}
}

/** A router records what it was asked to route, so the wiring is assertable. */
class StubRouter extends StubComponent {
	readonly routed: { pattern: string; bucket: unknown }[] = [];

	get url() {
		return `https://${this.name}.stub.cloudfront.net`;
	}

	routeBucket(pattern: string, bucket: unknown) {
		this.routed.push({ pattern, bucket });
	}
}

/**
 * A cluster with the five parts a connection URL is composed from, plus the
 * reader endpoint an Aurora cluster has without anything creating a replica.
 */
class StubAurora extends StubComponent {
	readonly host = 'db.stub.rds.amazonaws.com';
	readonly reader = 'db-ro.stub.rds.amazonaws.com';
	readonly port = 5432;
	readonly database = 'stubdb';
	readonly username = 'postgres';
	readonly password = 'stub-password';
}

/** A secret is not an `sst.aws.*` component and carries a value, not an address. */
class StubSecret {
	readonly name: string;

	constructor(name: string, placeholder?: string) {
		this.name = name;
		this.value = placeholder ?? `stub-secret-${name}`;
	}

	readonly value: string;

	getSSTLink() {
		return { properties: { value: this.value }, include: [] };
	}
}

const util = {
	/** Resolves eagerly, so `provides()` returns real strings under test. */
	all<T>(values: T[]) {
		return { apply: <R>(fn: (v: T[]) => R) => fn(values) };
	},
	/** The single-value form of `all`, same eagerness. */
	output<T>(value: T) {
		return { apply: <R>(fn: (v: T) => R) => fn(value) };
	},
	interpolate(strings: TemplateStringsArray, ...values: unknown[]) {
		return strings.reduce((out, part, i) => out + part + (values[i] ?? ''), '');
	},
};

Object.assign(globalThis, {
	sst: {
		Secret: StubSecret,
		aws: {
			Bucket: StubComponent,
			Queue: StubComponent,
			SnsTopic: StubComponent,
			Function: StubComponent,
			ApiGatewayV2: StubComponent,
			StaticSite: StubComponent,
			Router: StubRouter,
			Aurora: StubAurora,
		},
	},
	$util: util,
	$interpolate: util.interpolate,
});
