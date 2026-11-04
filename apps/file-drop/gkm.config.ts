import { defineWorkspace } from '@geekmidas/cli/config';

/**
 * The smallest workspace that deploys a `FileServer`: a page that uploads, an
 * API that presigns, and a bucket served through a CDN. No database.
 *
 * It exists to prove the compose + `objects: s3` path against real AWS — the
 * ACM certificate, the CloudFront distribution, the bucket policy — which
 * kitchen-sink is too big to iterate on.
 *
 * `prod` is `geekmidas.cloud`: the site answers on the apex, the API on
 * `api.geekmidas.cloud`, and the CDN on `drop-server.geekmidas.cloud`.
 * Hostinger holds the zone; the deploy reads its token (`gkm login --provider
 * hostinger`, or `HOSTINGER_API_TOKEN`) to write the records and the CDN
 * certificate's validation CNAME.
 */
export default defineWorkspace({
	name: 'file-drop',
	stages: { local: 'dev', deployed: ['prod'] },
	constructs: ['./constructs/**/*.ts', './apps/*/endpoints/**/*.ts'],
	domains: { prod: 'geekmidas.cloud' },
	dns: { 'geekmidas.cloud': { provider: 'hostinger' } },
	deploy: {
		default: 'compose',
		telemetry: { prod: false },
		// The server is the stage's `GKM_SERVER_IPV4` secret; `deploy` is the
		// user `gkm compose:server` creates there.
		compose: { server: { prod: { user: 'deploy' } } },
		// The point of this app: the deploy creates the bucket in AWS and puts
		// CloudFront in front of each file server, while the API and the site
		// run in the compose stack. The certificate is in us-east-1 whatever
		// this says — the one region CloudFront reads certificates from.
		objects: { prod: { provider: 's3', region: 'eu-west-1' } },
	},
});
