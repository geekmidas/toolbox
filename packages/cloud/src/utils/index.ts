import os from 'node:os';
import snakecase from 'lodash.snakecase';

export function getLocalIpAddress() {
	const networkInterfaces = os.networkInterfaces();
	for (const interfaceName in networkInterfaces) {
		const addresses = networkInterfaces[interfaceName] || [];
		for (const addressInfo of addresses) {
			// Look for an IPv4 address that is not internal (loopback)
			if (addressInfo.family === 'IPv4' && !addressInfo.internal) {
				return addressInfo.address;
			}
		}
	}
	return null; // No suitable IP address found
}

export function environmentCase(name: string) {
	return snakecase(name)
		.toUpperCase()
		.replace(/_\d+/g, (r) => {
			return r.replace('_', '');
		});
}
export enum ResourceType {
	ApiGatewayV2 = 'sst.aws.ApiGatewayV2',
	Postgres = 'sst.aws.Postgres',
	Function = 'sst.aws.Function',
	Bucket = 'sst.aws.Bucket',
	Vpc = 'sst.aws.Vpc',
	Secret = 'sst.sst.Secret',
	SSTSecret = 'sst:sst:Secret',
	SSTFunction = 'sst:sst:Function',
	SSTApiGatewayV2 = 'sst:aws:ApiGatewayV2',
	SSTPostgres = 'sst:aws:Postgres',
	SSTBucket = 'sst:aws:Bucket',
	SnsTopic = 'sst:aws:SnsTopic',
}

const secret = (name: string, value: Secret) => ({
	[environmentCase(name)]: value.value,
});
const postgres = (key: string, value: Postgres) => {
	const prefix = `${environmentCase(key)}`;
	return {
		[`${prefix}_NAME`]: value.database,
		[`${prefix}_HOST`]: value.host,
		[`${prefix}_PASSWORD`]: value.password,
		[`${prefix}_PORT`]: value.port,
		[`${prefix}_USERNAME`]: value.username,
	};
};

const bucket = (name: string, value: Bucket) => {
	const prefix = `${environmentCase(name)}`;
	return {
		[`${prefix}_NAME`]: value.name,
	};
};

const topic = (name: string, value: SnsTopic) => {
	const prefix = `${environmentCase(name)}`;
	const key = `${prefix}_ARN`;

	return {
		[key]: value.arn,
	};
};

const noop = (_name: string, _value: any) => ({});

const processors: Record<ResourceType, ResourceProcessor<any>> = {
	[ResourceType.ApiGatewayV2]: noop,
	[ResourceType.Function]: noop,
	[ResourceType.Vpc]: noop,
	[ResourceType.Secret]: secret,
	[ResourceType.Postgres]: postgres,
	[ResourceType.Bucket]: bucket,

	[ResourceType.SSTSecret]: secret,
	[ResourceType.SSTBucket]: bucket,
	[ResourceType.SSTFunction]: noop,
	[ResourceType.SSTPostgres]: postgres,
	[ResourceType.SSTApiGatewayV2]: noop,
	[ResourceType.SnsTopic]: topic,
};

export function buildResourceEnv(
	record: Record<string, Resource | string>,
): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, value] of Object.entries(record)) {
		if (typeof value === 'string') {
			env[environmentCase(k)] = value;
			continue;
		}

		const processor = processors[value.type];
		if (processor) {
			Object.assign(env, processor(k, value));
		} else {
		}
	}

	return env;
}

export type ApiGatewayV2 = {
	type: ResourceType.ApiGatewayV2;
	url: string;
};

export type Postgres = {
	database: string;
	host: string;
	password: string;
	port: number;
	type: ResourceType.Postgres;
	username: string;
};

export type Function = {
	name: string;
	type: ResourceType.Function;
};

export type Bucket = {
	name: string;
	type: ResourceType.Bucket;
};

export type SnsTopic = {
	arn: string;
	type: ResourceType.SnsTopic;
};

export type Vpc = {
	bastion: string;
	type: ResourceType.Vpc;
};

export type Secret = {
	type: ResourceType.Secret;
	value: string;
};

export type Resource =
	| ApiGatewayV2
	| Postgres
	| Function
	| Bucket
	| Vpc
	| Secret;

export type ResourceProcessor<K extends Resource> = (
	name: string,
	value: K,
) => Record<string, string | number>;
