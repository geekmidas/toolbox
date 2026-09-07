import type { ReactNode } from 'react';

export const metadata = {
	title: 'kitchen-sink admin',
	description:
		'The second site variant, so the deploy has two to choose between',
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html lang="en">
			<body
				style={{
					margin: 0,
					fontFamily: 'ui-sans-serif, system-ui, sans-serif',
					background: '#0b0e14',
					color: '#e6edf7',
				}}
			>
				{children}
			</body>
		</html>
	);
}
