/**
 * What a workspace needs to reach the host it was scaffolded for.
 *
 * The constructs are the same whichever target is picked — a `Database` is a
 * Postgres on Dokploy and an RDS instance on AWS, and nothing in the
 * application says which. What differs is around them: the deploy script, and
 * for SST the config SST runs and the packages that config imports.
 */

import { canonicalId } from '@geekmidas/manifest';
import { databaseFor, emailFor } from '../constructs.js';
import { DEPENDENCY_VERSIONS } from '../dependencies.js';
import type { GeneratedFile, TemplateOptions } from '../templates/index.js';
import { GEEKMIDAS_VERSIONS } from '../versions.js';

export interface DeployPackage {
	scripts: Record<string, string>;
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
}

export function deployPackage(options: TemplateOptions): DeployPackage {
	switch (options.deployTarget) {
		case 'dokploy':
			return {
				scripts: {
					deploy: 'gkm deploy --provider dokploy --stage production',
				},
				dependencies: {},
				devDependencies: {},
			};
		case 'sst': {
			const v = GEEKMIDAS_VERSIONS;
			return {
				scripts: {
					// The build writes `.gkm/manifest/aws.ts`, which is all
					// `sst.config.ts` reads — it never imports the application.
					deploy: 'gkm build --provider aws && sst deploy --stage production',
				},
				// What `@geekmidas/cloud/sst` imports. They are optional peers of
				// the cloud package, so nothing installs them unless asked.
				dependencies: {
					'@geekmidas/cloud': v['@geekmidas/cloud'],
					'@geekmidas/db': v['@geekmidas/db'],
					'@geekmidas/envkit': v['@geekmidas/envkit'],
					'@geekmidas/events': v['@geekmidas/events'],
					'@geekmidas/manifest': v['@geekmidas/manifest'],
					'@geekmidas/storage': v['@geekmidas/storage'],
					pg: DEPENDENCY_VERSIONS.pg,
				},
				devDependencies: { sst: DEPENDENCY_VERSIONS.sst },
			};
		}
		default:
			return { scripts: {}, dependencies: {}, devDependencies: {} };
	}
}

export function generateDeployFiles(options: TemplateOptions): GeneratedFile[] {
	if (options.deployTarget !== 'sst') return [];
	if (!options.region) throw new Error('An SST deploy needs a region.');

	const db = databaseFor();
	const mail = emailFor();
	// A fullstack workspace always declares one; the others only when asked.
	const hasDatabase = options.template === 'fullstack' || options.services.db;

	// Provider inputs keyed by construct id: the two things a neutral
	// declaration cannot carry, and that the synth refuses to guess.
	const inputs = [
		...(hasDatabase
			? [
					`        // RDS needs a network. Created here rather than assumed, because a
        // VPC with NAT is a monthly cost in an account that may already
        // have one — replace it with \`sst.aws.Vpc.get(…)\` if so.
        ${db.id}: { vpc },`,
				]
			: []),
		...(options.services.mail
			? [
					`        // Every provider rejects an unverified sender, so there is no
        // default; the synth stops with \`EmailNeedsSender\` until it is set.
        ${mail.id}: { from: process.env.MAIL_FROM as string },`,
				]
			: []),
	];

	return [
		{
			path: 'sst.config.ts',
			content: `/// <reference path="./.sst/platform/config.d.ts" />

/**
 * ${options.name} on AWS.
 *
 * No bucket, cluster, queue or IAM is listed here: they come from the
 * constructs the application declares, through \`fromManifest\`. What is here
 * is what varies by stage, and the inputs a declaration cannot carry.
 *
 * Deploy with \`pnpm run deploy\`, which builds the manifest first.
 */
const region = '${options.region}';

export default $config({
  app(input) {
    return {
      name: '${options.name}',
      // A QA stage is disposable; a production database should not vanish
      // because somebody removed a stack.
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      protect: input?.stage === 'production',
      home: 'aws',
      providers: { aws: { region } },
    };
  },

  async run() {
    const { App, fromManifest, Stack } = await import('@geekmidas/cloud/sst');
    // Written by \`gkm build --provider aws\`. Imported rather than discovered,
    // so SST's toolchain never evaluates the application's own modules.
    const { backends, constructs } = await import('./.gkm/manifest/aws.js');

${hasDatabase ? "    const vpc = new sst.aws.Vpc('Vpc', { nat: 'ec2' });\n\n" : ''}    const app = new App({
      name: $app.name,
      stage: $app.stage,
      domain: '',
      region,
      hostedZoneId: '',
    });

    return fromManifest(
      new Stack(app, '${canonicalId(options.name)}'),
      constructs,
      {
${inputs.join('\n')}
      },
      backends,
    );
  },
});
`,
		},
	];
}
