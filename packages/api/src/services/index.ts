/**
 * BACKWARD COMPATIBILITY RE-EXPORTS
 *
 * Services have been moved to '@geekmidas/services' package.
 *
 * @deprecated Import from '@geekmidas/services' instead.
 * These re-exports will be removed in v3.0.0.
 */

export type {
  Service,
  ServiceRecord,
  ExtractServiceNames,
  HermodServiceInterface,
} from '@geekmidas/services';

export { ServiceDiscovery } from '@geekmidas/services';
