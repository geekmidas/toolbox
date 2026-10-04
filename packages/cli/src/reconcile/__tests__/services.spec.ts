import { describe, expect, it } from 'vitest';
import { describeServices, serviceAddresses } from '../containers';

describe('what gkm dev and gkm setup list', () => {
	const ports = {
		postgres: 28001,
		minio: 28002,
		'minio-console': 28003,
		mailpit: 28004,
		'mailpit-web': 28005,
	};

	it('lists every published port, with the pages as links', () => {
		expect(serviceAddresses(['postgres', 'minio', 'mailpit'], ports)).toEqual([
			{ container: 'postgres', label: 'postgres', address: 'localhost:28001' },
			{ container: 'minio', label: 'minio api', address: 'localhost:28002' },
			{
				container: 'minio',
				label: 'minio console',
				address: 'http://localhost:28003',
			},
			{ container: 'mailpit', label: 'smtp', address: 'localhost:28004' },
			{
				container: 'mailpit',
				label: 'mailpit inbox',
				address: 'http://localhost:28005',
			},
		]);
	});

	it('skips a port that was never assigned', () => {
		expect(serviceAddresses(['redis'], ports)).toEqual([]);
	});

	it('lines the addresses up under one another', () => {
		expect(
			describeServices(serviceAddresses(['postgres', 'mailpit'], ports)),
		).toEqual([
			'   postgres       localhost:28001',
			'   smtp           localhost:28004',
			'   mailpit inbox  http://localhost:28005',
		]);
	});
});
