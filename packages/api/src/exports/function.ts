import { FunctionBuilder } from '../constructs/FunctionBuilder';

/**
 * The default function factory for building cloud functions
 */
export const f = new FunctionBuilder();

export {
  Function,
  FunctionFactory,
} from '../constructs/Function';
export type {
  FunctionHandler,
  FunctionContext,
} from '../constructs/Function';

export { FunctionBuilder } from '../constructs/FunctionBuilder';
