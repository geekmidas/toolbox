import type { FeatureContext } from '@geekmidas/constructs/testing';
import type { Browser } from '#test';

/**
 * Sign in the way a person does: ask for a link, open the email that was
 * actually sent, follow it. The cookie lands in the browser's jar, so every
 * later request from this browser carries it.
 */
export async function signIn(
	{
		browser,
		mailbox,
	}: Pick<FeatureContext<Browser, unknown>, 'browser' | 'mailbox'>,
	email: string,
): Promise<void> {
	await browser.auth.signIn.magicLink({ email });
	await browser.visit((await mailbox(email).last()).link!);
}
