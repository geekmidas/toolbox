import { defineConfig } from 'vitepress';

export default defineConfig({
  title: '@geekmidas/toolbox',
  description: 'A TypeScript monorepo for building modern web applications',

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
          { text: '@geekmidas/db', link: '/packages/db' },
          { text: '@geekmidas/events', link: '/packages/events' },
          { text: '@geekmidas/logger', link: '/packages/logger' },
          { text: '@geekmidas/storage', link: '/packages/storage' },
          { text: '@geekmidas/telescope', link: '/packages/telescope' },
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
          { text: '@geekmidas/testkit', link: '/packages/testkit' },
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
      dark: 'github-light',
    },
  },
});
