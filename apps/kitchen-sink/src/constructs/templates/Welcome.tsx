import {
	Button,
	Container,
	Heading,
	Html,
	Text,
} from '@react-email/components';

export interface WelcomeProps {
	name: string;
	/** Where the button points — an address, so it arrives as stage config. */
	appUrl: string;
}

/**
 * The welcome mail, as a React component.
 *
 * Templates are the one structural thing about email: they are code, they ship
 * with the handler, and which ones exist cannot differ between stages. Passing
 * them to the construct is also what types `sendTemplate('welcome', …)`.
 */
export const Welcome = ({ name, appUrl }: WelcomeProps) => (
	<Html>
		<Container>
			<Heading>Welcome, {name}</Heading>
			<Text>Your account is ready.</Text>
			<Button href={appUrl}>Open the app</Button>
		</Container>
	</Html>
);
