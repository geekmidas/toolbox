import type { GeneratedFile, TemplateOptions } from '../templates/index.js';
import type { SiteApp } from './site-auth.js';
import { nextSiteFiles } from './web.js';
import { tanstackSiteFiles } from './web-tanstack.js';

export const WEB_SITE: SiteApp = {
	key: 'web',
	id: 'Web',
	exportName: 'web',
	dir: 'apps/web',
	title: (options) => options.name,
};

export const ADMIN_SITE: SiteApp = {
	key: 'admin',
	id: 'Admin',
	exportName: 'admin',
	dir: 'apps/admin',
	title: (options) => `${options.name} admin`,
};

/**
 * The fullstack template's web site and admin panel, in the framework it was
 * given, with the constructs that make each one an app.
 */
export function generateSiteFiles(options: TemplateOptions): GeneratedFile[] {
	if (!options.monorepo || options.template !== 'fullstack') return [];

	const files =
		options.frontendFramework === 'tanstack-start'
			? tanstackSiteFiles
			: nextSiteFiles;

	return [
		...siteConstructs(options),
		...files(options, WEB_SITE),
		...files(options, ADMIN_SITE),
	];
}

/** `constructs/site.ts` and `constructs/admin.ts`. */
function siteConstructs(options: TemplateOptions): GeneratedFile[] {
	const variant =
		options.frontendFramework === 'tanstack-start' ? 'tanstack' : 'next';

	return [
		{
			path: 'constructs/site.ts',
			content: `import { StaticSite } from '@geekmidas/constructs/site';
import { api } from './api.ts';
import { auth } from './auth.ts';

/**
 * The public web site — a construct like any other, which is what makes it
 * an app.
 *
 * \`root\` puts it on the stage's bare domain; every other app answers on
 * \`<app>.<domain>\`. \`.dependsOn()\` is the single fact behind four things
 * that are hand-maintained otherwise: this site's build-time API and auth
 * URLs, the API's CORS origins, the auth server's trusted origins, and which
 * generated client lands here.
 */
export const web = new StaticSite('Web', {
  path: 'apps/web',
  variant: '${variant}',
  root: true,
}).dependsOn([api, auth]);
`,
		},
		{
			path: 'constructs/admin.ts',
			content: `import { StaticSite } from '@geekmidas/constructs/site';
import { api } from './api.ts';
import { auth } from './auth.ts';

/**
 * The admin panel, on \`admin.<domain>\`.
 *
 * It restricts nothing itself: anyone can load it, and a page is only data
 * the API agrees to send. The API is what refuses someone without the
 * \`admin.access\` permission (\`apps/api/src/router.ts\`); the panel asks
 * \`GET /profiles/me\` only to decide what to draw.
 */
export const admin = new StaticSite('Admin', {
  path: 'apps/admin',
  variant: '${variant}',
}).dependsOn([api, auth]);
`,
		},
	];
}
