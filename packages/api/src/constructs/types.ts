import type { StandardSchemaV1 } from '@standard-schema/spec';

export type InferStandardSchema<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T>
  : never;

export type ComposableStandardSchema =
  | StandardSchemaV1
  | {
      [key: string]: StandardSchemaV1 | undefined;
    };

export type InferComposableStandardSchema<T> = T extends StandardSchemaV1
  ? StandardSchemaV1.InferOutput<T>
  : T extends { [key: string]: StandardSchemaV1 | undefined }
    ? {
        [K in keyof T as T[K] extends StandardSchemaV1
          ? K
          : never]: T[K] extends StandardSchemaV1
          ? StandardSchemaV1.InferOutput<T[K]>
          : never;
      }
    : {};

export type RemoveUndefined<T> = {
  [K in keyof T as T[K] extends undefined ? never : K]: T[K];
};

export enum FunctionType {
  Cron = 'dev.geekmidas.function.cron',
  Endpoint = 'dev.geekmidas.function.endpoint',
  Function = 'dev.geekmidas.function.function',
}

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS';

export type LowerHttpMethod<T extends HttpMethod> = Lowercase<T>;
