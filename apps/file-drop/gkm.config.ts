import { defineWorkspace } from '@geekmidas/cli/config';

/**
 * The smallest workspace that deploys a `FileServer`: a page that uploads, an
 * API that presigns, and a bucket served through a CDN. No database.
 *
 * It exists to prove the compose + `objects: s3` path against real AWS — the
 * ACM certificate, the CloudFront distribution, the bucket policy — which
 * kitchen-sink is too big to iterate on.
 *
 * `prod`'s domain is `FILE_DROP_DOMAIN`, read from the environment so no
 * one's domain is baked into the example: the site answers on it, the API on
 * `api.<domain>`, and the CDN on `drop-server.<domain>`. Hostinger holds its
 * zone; the deploy reads its token (`gkm login --provider hostinger`, or
 * `HOSTINGER_API_TOKEN`) to write the records and the CDN certificate's
 * validation CNAME. Unset, there is no domain: `gkm dev` needs none, and a
 * deploy stops with `FileServerCdnNeedsDomain`.
 */
const domain = process.env.FILE_DROP_DOMAIN;

export default defineWorkspace({
	name: 'file-drop',
	stages: { local: 'dev', deployed: ['prod'] },
	constructs: [
		'./constructs/**/*.ts',
		'./apps/*/{endpoints,processors}/**/*.ts',
	],
	...(domain
		? {
				domains: { prod: domain },
				dns: { [domain]: { provider: 'hostinger' as const } },
			}
		: {}),
	deploy: {
		default: 'compose',
		telemetry: { prod: false },
		// The server is the stage's `GKM_SERVER_IPV4` secret; `deploy` is the
		// user `gkm compose:server` creates there. Served by the server's
		// shared Traefik edge rather than the stack's own Caddy.
		compose: {
			proxy: { prod: 'traefik' },
			server: { prod: { user: 'deploy' } },
		},
		// The point of this app: the deploy creates the bucket in AWS and puts
		// CloudFront in front of each file server, while the API and the site
		// run in the compose stack. The certificate is in us-east-1 whatever
		// this says — the one region CloudFront reads certificates from.
		objects: { prod: { provider: 's3', region: 'eu-west-1' } },
	},
});
