import { EndpointFactory } from './EndpointFactory';

export { EndpointFactory } from './EndpointFactory';
export {
  Endpoint,
  type EndpointOutput,
  type EndpointSchemas,
  type EndpointHandler,
  type EndpointContext,
} from './Endpoint';
export { EndpointBuilder } from './EndpointBuilder';
export { type MappedAudit, type ActorExtractor } from './audit';

export const e = new EndpointFactory();
