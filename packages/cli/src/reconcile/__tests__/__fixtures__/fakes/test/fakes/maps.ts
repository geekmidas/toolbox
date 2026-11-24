import { mapsFake } from '@geekmidas/constructs/maps/fake';

export default mapsFake({
	fetch: () => Response.json({ status: 'OK', results: [] }),
});
