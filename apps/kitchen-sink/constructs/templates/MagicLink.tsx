import {
	Button,
	Container,
	Heading,
	Html,
	Text,
} from '@react-email/components';

export interface MagicLinkProps {
	/** Where the link goes. Signed and single-use — it *is* the credential. */
	url: string;
}

/**
 * The sign-in link.
 *
 * The whole of the login flow the user sees: no password to choose, forget,
 * reuse, or leak, and nothing for the app to store that is worth stealing.
 */
export const MagicLink = ({ url }: MagicLinkProps) => (
	<Html>
		<Container>
			<Heading>Sign in</Heading>
			<Text>This link signs you in. It works once, and expires shortly.</Text>
			<Button href={url}>Sign in</Button>
			<Text>{url}</Text>
		</Container>
	</Html>
);
