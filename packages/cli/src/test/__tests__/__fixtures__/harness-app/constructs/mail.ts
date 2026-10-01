import { Email } from '@geekmidas/constructs/email';

// The app sends mail, so a magic link can be read back: what gives the
// generated browser a `signIn`.
export const mail = new Email('Mail', { templates: {} });
