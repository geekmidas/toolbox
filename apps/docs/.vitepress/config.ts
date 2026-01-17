import { defineConfig } from 'vitepress';

export default defineConfig({
  title: '@geekmidas/toolbox',
  description: 'A TypeScript monorepo for building modern web applications',

  // GitHub Pages deployment
  base: '/toolbox/',

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/api/' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
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
