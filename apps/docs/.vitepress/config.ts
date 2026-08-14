import { defineConfig } from 'vitepress';

// Versioned docs. Each version is a separate build deployed to its own path:
//   /toolbox/       ← the released line (built from the `v9` branch)
//   /toolbox/next/  ← in development (built from `main`)
// `DOCS_BASE` and `DOCS_VERSION` are set per build by .github/workflows/docs.yml;
// the defaults are for local `pnpm docs:dev`.
const SITE = 'https://geekmidas.github.io/toolbox';
const base = process.env.DOCS_BASE ?? '/toolbox/';
const version = process.env.DOCS_VERSION ?? 'next';

// Cross-version links must be absolute — VitePress prefixes root-relative
// links with `base`, which would produce /toolbox/toolbox/next/.
// `next` is not yet a published alpha — it tracks `main`, where the constructs
// paradigm is being introduced. Relabel once 10.0.0-alpha.0 ships.
const versions = [
  { text: 'v9 (released)', link: `${SITE}/` },
  { text: 'next (in development)', link: `${SITE}/next/` },
];

export default defineConfig({
  title: '@geekmidas/toolbox',
  description: 'A TypeScript monorepo for building modern web applications',

  base,

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/api/' },
      { text: version, items: versions },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Constructs Paradigm (RFC)', link: '/guide/constructs-paradigm' },
          { text: 'Fullstack Init', link: '/guide/fullstack-init' },
          { text: 'Development Server', link: '/guide/dev-server' },
          { text: 'Project Structure', link: '/guide/project-structure' },
          { text: 'CLI Reference', link: '/guide/cli-reference' },
          { text: 'Workspaces', link: '/guide/workspaces' },
          { text: 'Testing', link: '/guide/testing' },
          { text: 'Deployment', link: '/guide/deployment' },
        ],
      },
      {
        text: 'Core Packages',
        items: [
          { text: '@geekmidas/constructs', link: '/packages/constructs' },
          { text: '@geekmidas/client', link: '/packages/client' },
          { text: '@geekmidas/cli', link: '/packages/cli' },
        ],
      },
      {
        text: 'Infrastructure',
        items: [
          { text: '@geekmidas/auth', link: '/packages/auth' },
          { text: '@geekmidas/cache', link: '/packages/cache' },
          { text: '@geekmidas/cloud', link: '/packages/cloud' },
          { text: '@geekmidas/db', link: '/packages/db' },
          { text: '@geekmidas/events', link: '/packages/events' },
          { text: '@geekmidas/logger', link: '/packages/logger' },
          { text: '@geekmidas/storage', link: '/packages/storage' },
        ],
      },
      {
        text: 'Development Tools',
        items: [
          { text: '@geekmidas/telescope', link: '/packages/telescope' },
          { text: '@geekmidas/studio', link: '/packages/studio' },
          { text: '@geekmidas/testkit', link: '/packages/testkit' },
        ],
      },
      {
        text: 'Utilities',
        items: [
          { text: '@geekmidas/audit', link: '/packages/audit' },
          { text: '@geekmidas/envkit', link: '/packages/envkit' },
          { text: '@geekmidas/errors', link: '/packages/errors' },
          { text: '@geekmidas/rate-limit', link: '/packages/rate-limit' },
          { text: '@geekmidas/schema', link: '/packages/schema' },
          { text: '@geekmidas/services', link: '/packages/services' },
          { text: '@geekmidas/emailkit', link: '/packages/emailkit' },
        ],
      },
      {
        text: 'UI',
        items: [
          { text: '@geekmidas/ui', link: '/packages/ui' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/geekmidas/toolbox' },
    ],

    search: {
      provider: 'local',
    },
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark',
    },
  },
});
