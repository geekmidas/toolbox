# @geekmidas/logger

Simple structured logging library for Node.js and browsers.

## Installation

```bash
pnpm add @geekmidas/logger
```

## Features

- Standard logger interface with multiple log levels
- Structured logging with context objects
- Child logger support with context inheritance
- Automatic timestamp injection
- Multiple implementations: Console, Pino

## Package Exports

| Export | Description |
|--------|-------------|
| `/` | Logger interface and types |
| `/pino` | Pino logger implementation |
| `/console` | Console logger implementation |
| `/redact` | `DEFAULT_REDACT_PATHS` - standard sensitive field paths for log redaction |
| `/otel` | `otelStreamWrite` - the OpenTelemetry bridge, for a logger made with `pino()` directly |

## Basic Usage

### Console Logger

```typescript
import { ConsoleLogger } from '@geekmidas/logger/console';

const logger = new ConsoleLogger({
  app: 'myApp',
  version: '1.0.0'
});

// Simple logging
logger.info('Application started');
logger.debug('Debug message');
logger.warn('Warning message');
logger.error('Error message');

// Structured logging with context
logger.info({ userId: 123, action: 'login' }, 'User logged in');
logger.error({ error: err.message, stack: err.stack }, 'Request failed');
```

### Pino Logger

```typescript
import { PinoLogger } from '@geekmidas/logger/pino';

const logger = new PinoLogger({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
});

logger.info({ requestId: 'req-123' }, 'Processing request');
```

### Child Loggers

Create child loggers with inherited context:

```typescript
const logger = new ConsoleLogger({ app: 'myApp' });

// Create child logger with additional context
const requestLogger = logger.child({
  requestId: 'req-123',
  userId: 'user-456',
});

// All logs from requestLogger include the inherited context
requestLogger.info('Processing request');
// Output: { app: 'myApp', requestId: 'req-123', userId: 'user-456', msg: 'Processing request' }

// Create nested child logger
const dbLogger = requestLogger.child({ module: 'database' });
dbLogger.debug('Executing query');
// Output: { app: 'myApp', requestId: 'req-123', userId: 'user-456', module: 'database', msg: 'Executing query' }
```

## Logger Interface

All logger implementations follow this interface:

```typescript
interface Logger {
  info(msg: string): void;
  info(obj: object, msg: string): void;

  debug(msg: string): void;
  debug(obj: object, msg: string): void;

  warn(msg: string): void;
  warn(obj: object, msg: string): void;

  error(msg: string): void;
  error(obj: object, msg: string): void;

  child(bindings: object): Logger;
}
```

## Log Redaction

`createLogger` from `@geekmidas/logger/pino` redacts sensitive fields **by
default**: a logger that was never told about passwords and tokens still masks
them. `redact: false` is the explicit opt-out.

```typescript
import { createLogger } from '@geekmidas/logger/pino';

const logger = createLogger();
logger.info({ password: 'secret123', user: 'john' }, 'Login');
// { "password": "[Redacted]", "user": "john", ... }

// Add paths (merged with the defaults)
createLogger({ redact: ['user.ssn'] });

// Only your paths
createLogger({ redact: { paths: ['only.this'], resolution: 'override' } });

// Opt out: nothing is redacted
createLogger({ redact: false });
```

::: warning Changed in 10.0
Before 10.0, leaving `redact` out meant no redaction. If you relied on seeing a
default-redacted field in logs (tests asserting on log output, for example),
pass `redact: false`.
:::

The `/redact` export provides a standard list of sensitive field paths for use with Pino's redaction feature:

```typescript
import { DEFAULT_REDACT_PATHS } from '@geekmidas/logger/redact';
import pino from 'pino';

const logger = pino({
  redact: DEFAULT_REDACT_PATHS,
});

// Sensitive fields are automatically redacted:
// password, token, secret, authorization, cookie,
// credit card numbers, SSNs, connection strings, etc.
logger.info({ user: { password: 'secret123' } }, 'User data');
// Output: { user: { password: '[REDACTED]' } }
```

## OpenTelemetry

When an OpenTelemetry `LoggerProvider` is registered globally — as a
production server's generated telemetry does when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set — a `createLogger` logger also emits each
record through `@opentelemetry/api-logs`:

- `severityNumber` and `severityText` from the pino level;
- `body`: the message;
- attributes: the record's fields, after redaction — path redaction and URL
  credentials alike, so the exported copy is exactly as redacted as stdout;
- the trace and span ids of the span active where it was logged.

stdout is unchanged. It is done in pino's `streamWrite` hook, on the calling
thread, so the active span is the caller's even with a transport — and it
hooks no module loading, so it works inside a single bundled file. With no
provider registered nothing is parsed or emitted.

`@opentelemetry/api-logs` keeps its provider on `globalThis` under a
`Symbol.for` key, so the copy the logger imports and the copy the SDK
registers through share one provider, even when a bundle holds both.

A logger made with `pino()` directly opts in with the hook:

```typescript
import pino from 'pino';
import { otelStreamWrite } from '@geekmidas/logger/otel';

const logger = pino({ hooks: { streamWrite: otelStreamWrite } });
```

## Usage with Endpoints

```typescript
import { api } from '../constructs/api';

const endpoint = api
  .get('/users/:id')
  .handle(async ({ params, logger }) => {
    logger.info({ userId: params.id }, 'Fetching user');

    try {
      const user = await getUser(params.id);
      logger.info({ userId: params.id }, 'User fetched successfully');
      return user;
    } catch (error) {
      logger.error({ userId: params.id, error: error.message }, 'Failed to fetch user');
      throw error;
    }
  });
```
