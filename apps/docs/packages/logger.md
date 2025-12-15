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

- `/` - Logger interface
- `/pino` - Pino logger implementation
- `/console` - Console logger implementation

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

## Usage with Endpoints

```typescript
import { e } from '@geekmidas/constructs/endpoints';

const endpoint = e
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
