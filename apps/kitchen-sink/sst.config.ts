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
		const { discover } = await import('@geekmidas/cli/reconcile');
		const { fromManifest, Stack } = await import('@geekmidas/cloud/sst');

		// The same discovery `gkm dev` runs, against the same glob. One manifest,
		// two targets — which is the claim this file exists to make true.
		const manifest = await discover({
			patterns:
				'src/{constructs,crons,endpoints,functions,queues,subscribers}/**/*.ts',
			cwd: process.cwd(),
		});

		// A VPC is required rather than invented, because creating one means
		// creating a NAT gateway — a monthly cost in an account whose networking
		// may already be somebody else's decision.
		const vpc = new sst.aws.Vpc('Vpc', { nat: 'ec2' });

		const stack = new Stack('KitchenSink');

		return fromManifest(
			stack,
			manifest,
			{
				// Provider-specific inputs, keyed by construct id. Everything a
				// neutral declaration *can* express is already in the manifest.
				KitchenSink: { vpc },
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
