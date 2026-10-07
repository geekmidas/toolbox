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

/** One `deploy:<stage>` script per deployed stage. */
const perStage = (
	options: TemplateOptions,
	command: (stage: string) => string,
): Record<string, string> =>
	Object.fromEntries(
		options.stages.deployed.map((stage) => [`deploy:${stage}`, command(stage)]),
	);

export function deployPackage(options: TemplateOptions): DeployPackage {
	switch (options.deployTarget) {
		case 'dokploy':
			return {
				scripts: perStage(options, (stage) => `gkm deploy --stage ${stage}`),
				dependencies: {},
				devDependencies: {},
			};
		case 'sst': {
			const v = GEEKMIDAS_VERSIONS;
			return {
				// `gkm deploy` builds `.gkm/manifest/aws.ts` — all `sst.config.ts`
				// reads; it never imports the application — then runs
				// `sst deploy` and checks what it released.
				scripts: perStage(options, (stage) => `gkm deploy --stage ${stage}`),
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
	if (!options.region) throw new SstNeedsRegion();

	const db = databaseFor();
	const mail = emailFor();
	const hasDatabase = options.constructs.database;

	// Provider inputs keyed by construct id: the two things a neutral
	// declaration cannot carry. `fromManifest` types its overrides from the
	// manifest, so leaving either out is a type error in sst.config.ts.
	const inputs = [
		...(hasDatabase
			? [
					`        // RDS needs a network. Created here rather than assumed, because a
        // VPC with NAT is a monthly cost in an account that may already
        // have one — replace it with \`sst.aws.Vpc.get(…)\` if so.
        ${db.id}: { vpc },`,
				]
			: []),
		...(options.constructs.mail
			? [
					`        // Every provider rejects an unverified sender, so there is no
        // default — \`fromManifest\` requires it, by the manifest's types.
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
 * Deploy with \`gkm deploy --stage <stage>\`, which builds the manifest first.
 */
const region = '${options.region}';

/** From \`stages.protected\` in gkm.config.ts. */
const PROTECTED: string[] = ${JSON.stringify(options.stages.protected ?? []).replace(/"/g, "'")};

export default $config({
  app(input) {
    return {
      name: '${options.name}',
      // Any other stage is disposable; a protected one's database should not
      // vanish because somebody removed a stack.
      removal: PROTECTED.includes(input?.stage) ? 'retain' : 'remove',
      protect: PROTECTED.includes(input?.stage),
      home: 'aws',
      providers: { aws: { region } },
    };
  },

  async run() {
    const { App, fromManifest, Stack } = await import('@geekmidas/cloud/sst');
    // Written by \`gkm build\`. Imported rather than discovered,
    // so SST's toolchain never evaluates the application's own modules.
    const { backends, constructs } = await import('./.gkm/manifest/aws.js');

${hasDatabase ? "    const vpc = new sst.aws.Vpc('Vpc', { nat: 'ec2' });\n\n" : ''}    const app = new App({
      name: $app.name,
      stage: $app.stage,
      domain: '',
      region,
      hostedZoneId: '',
    });

    const provisioned = fromManifest(
      new Stack(app, '${canonicalId(options.name)}'),
      constructs,
      {
${inputs.join('\n')}
      },
      backends,
    );

    // Each surface's URL, by its id: SST prints these and writes them to
    // .sst/outputs.json, where \`gkm deploy\` reads them to health-check
    // what it released.
    return Object.fromEntries(
      Object.entries(constructs)
        .filter(([, c]) => c.kind === 'rest-api' || c.kind === 'site')
        .map(([id]) => [id, provisioned[id]!.provides().url]),
    );
  },
});
`,
		},
	];
}

/**
 * An SST scaffold asked for without a region. `init` always resolves one —
 * asked, `--region`, or eu-west-1 under `--yes` — so this is a caller's bug.
 */
export class SstNeedsRegion extends Error {
	constructor() {
		super('An SST deploy needs a region: pass --region, e.g. eu-west-1.');
		this.name = 'SstNeedsRegion';
	}
}
