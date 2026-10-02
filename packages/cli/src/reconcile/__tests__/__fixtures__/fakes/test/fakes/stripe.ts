import { fake } from '@geekmidas/constructs/external-api';

export default fake.image('stripe/stripe-mock', {
	port: 12111,
	credentials: { secretKey: 'sk_test_fake' },
});
