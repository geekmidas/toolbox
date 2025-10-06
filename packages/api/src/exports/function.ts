import { FunctionBuilder, FunctionFactory } from '../constructs/Function';

/**
 * The default function factory for building cloud functions
 */
export const f = new FunctionBuilder();

/**
 * The function factory with support for default services
 */
export const functionFactory = new FunctionFactory([]);

export { Function, FunctionBuilder, FunctionFactory } from '../constructs/Function';
export type {
  FunctionHandler,
  FunctionContext,
} from '../constructs/Function';