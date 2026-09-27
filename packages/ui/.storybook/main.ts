import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
	stories: ['../src/**/*.stories.@(ts|tsx)'],
	// Controls, actions, backgrounds, viewport and interactions are part of
	// `storybook` itself since 9; docs is still an addon.
	addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
	framework: {
		name: '@storybook/react-vite',
		options: {},
	},
	viteFinal: async (config) => {
		// Add Tailwind CSS v4 plugin
		const tailwindcss = await import('@tailwindcss/vite');
		config.plugins = config.plugins || [];
		config.plugins.push(tailwindcss.default());
		return config;
	},
};

export default config;
