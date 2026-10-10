import { fake } from '@geekmidas/constructs/credential';
import type { payments } from '@kitchen-sink/constructs/payments.js';

/**
 * The payment provider's keys on the test stage. Nobody issues a credential
 * to a stage `gkm test` sets up fresh, so a test reaching
 * `services.payments` is handed this — checked against the construct's schema
 * like the real one. Found by its path, `test/fakes/<construct>.ts`; the
 * construct never imports it, so it is in no deployed bundle, and a deployed
 * stage still needs `PAYMENTS_CREDENTIALS` set.
 */
export default fake.credential<typeof payments>({
	secretKey: 'sk_test_fake',
	webhookSecret: 'whsec_test_fake',
});
