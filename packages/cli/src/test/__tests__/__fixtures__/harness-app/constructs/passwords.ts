import { RandomPassword } from '@geekmidas/constructs/random-password';

// A secret of the app's own, beside the one the auth server signs with — only
// this one is a construct a handler depends on.
export const adminPassword = new RandomPassword('AdminPassword');
