import type { Preview } from '@storybook/react';
import '../src/styles/globals.css';

const preview: Preview = {
	parameters: {
		backgrounds: {
			default: 'dark',
			values: [
				{ name: 'dark', value: '#171717' },
				{ name: 'surface', value: '#1c1c1c' },
				{ name: 'light', value: '#fafafa' },
			],
		},
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		layout: 'centered',
	},
};

export default preview;
