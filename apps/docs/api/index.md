# API Reference - @geekmidas/api

::: info
Detailed API documentation will be generated from TypeScript source code using TypeDoc.
:::

## Main Exports

### Server
- `e` - Endpoint builder
- `HermodService` - Base service class
- `createError` - Error factory

### AWS Lambda
- `createLambdaHandler` - Lambda handler factory
- `LambdaAdapter` - AWS Lambda adapter

### Errors
- `HttpError` - Base HTTP error class
- `BadRequestError` - 400 errors
- `UnauthorizedError` - 401 errors
- `ForbiddenError` - 403 errors
- `NotFoundError` - 404 errors
- `ConflictError` - 409 errors
- `InternalServerError` - 500 errors