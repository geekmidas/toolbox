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

export const e = new EndpointFactory();
