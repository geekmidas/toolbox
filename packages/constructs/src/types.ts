export type RemoveUndefined<T> = {
  [K in keyof T as T[K] extends undefined ? never : K]: T[K];
};

export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS';

export type LowerHttpMethod<T extends HttpMethod> = Lowercase<T>;
