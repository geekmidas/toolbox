import type { Preview } from '@storybook/react-vite';
import '../src/styles/globals.css';

const preview: Preview = {
	// The starting background is a global now, not a parameter.
	initialGlobals: {
		backgrounds: { value: 'dark' },
	},
	parameters: {
		backgrounds: {
			options: {
				dark: { name: 'dark', value: '#171717' },
				surface: { name: 'surface', value: '#1c1c1c' },
				light: { name: 'light', value: '#fafafa' },
			},
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
