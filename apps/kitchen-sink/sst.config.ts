/// <reference path="./.sst/platform/config.d.ts" />

/**
 * kitchen-sink on AWS.
 *
 * The link that was missing: twelve provisioners existed and nothing invoked
 * them. This is the whole of the deploy-side configuration, and what is *not*
 * in it is the point — no bucket, no cluster, no queue, no link, no IAM. Those
 * come from the constructs the application already declares, through
 * `fromManifest`.
 *
 * What is here is exactly the two categories the design says belong at deploy:
 * things that vary by stage (which account, which region), and provider-specific
 * inputs a neutral declaration cannot carry (a VPC, an existing credential).
 */
export default $config({
	app(input) {
		return {
			name: 'kitchen-sink',
			// `retain` on production and remove elsewhere: a QA stage should be
			// disposable, and a production database should not vanish because
			// somebody removed a stack.
			removal: input?.stage === 'production' ? 'retain' : 'remove',
			protect: input?.stage === 'production',
			home: 'aws',
			providers: {
				aws: { region: 'eu-west-1' },
			},
		};
	},

	async run() {
		const { App, fromManifest, Stack } = await import('@geekmidas/cloud/sst');
		const { manifest } = await import('./.gkm/manifest.js');

		// `.gkm/manifest.ts` is written by `gkm build`, and importing it rather
		// than calling `discover()` here is deliberate: discovery imports the
		// application's own modules, so a deploy config that called it would
		// evaluate the whole runtime graph — React email templates included —
		// inside SST's toolchain. That failed on the JSX long before reaching
		// AWS, and would keep failing on the next thing an app imports.
		//
		// Same split `RestApi` makes by naming a routes glob: the build walks the
		// filesystem once, and everything downstream reads what it wrote. And
		// because it is a module rather than JSON, every id and key stays a
		// literal.

		// A VPC is required rather than invented, because creating one means
		// creating a NAT gateway — a monthly cost in an account whose networking
		// may already be somebody else's decision.
		const vpc = new sst.aws.Vpc('Vpc', { nat: 'ec2' });

		// `App` carries identity and the pre-resolved hosted zone; `Stack` is the
		// grouping inside it. Neither is doing much here — most provisioners take
		// the stack and ignore it — but the contract is what it is, and a QA stage
		// with no custom domain simply has no zone to resolve.
		const app = new App({
			name: $app.name,
			stage: $app.stage,
			domain: '',
			region: 'eu-west-1',
			hostedZoneId: '',
		});

		const stack = new Stack(app, 'KitchenSink');

		return fromManifest(
			stack,
			manifest,
			{
				// Provider-specific inputs, keyed by construct id. Everything a
				// neutral declaration *can* express is already in the manifest.
				KitchenSink: { vpc },
				// The sending identity: stage-varying by nature and not
				// defaultable, because every provider rejects an unverified
				// sender and a guess would fail at the first send rather than
				// here.
				Mail: { from: 'noreply@shortstaff.co.za' },
			},
			{
				// A cache in the declared database: no second resource, no second
				// credential, nothing to pay for while idle. `orders.cache()` would
				// say the same thing structurally; this says it for a standalone
				// `Cache` at deploy time.
				cache: 'db',
				// SES, and it uses credentials that already exist when they do —
				// see `Email`. With none supplied it provisions the chain.
				email: 'ses',
			},
		);
	},
});
