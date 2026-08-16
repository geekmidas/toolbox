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
 */

class StubComponent {
	readonly name: string;
	readonly nodes: { bucket: { region: string } };

	constructor(name: string, _props?: unknown) {
		this.name = name;
		this.nodes = { bucket: { region: 'stub-region' } };
	}
}

const util = {
	/** Resolves eagerly, so `provides()` returns real strings under test. */
	all<T>(values: T[]) {
		return { apply: <R>(fn: (v: T[]) => R) => fn(values) };
	},
	interpolate(strings: TemplateStringsArray, ...values: unknown[]) {
		return strings.reduce((out, part, i) => out + part + (values[i] ?? ''), '');
	},
};

Object.assign(globalThis, {
	sst: {
		aws: {
			Bucket: StubComponent,
			Queue: StubComponent,
			SnsTopic: StubComponent,
			Function: StubComponent,
			ApiGatewayV2: StubComponent,
		},
	},
	$util: util,
	$interpolate: util.interpolate,
});
