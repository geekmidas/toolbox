# @geekmidas/logger

A simple and flexible structured logging library for Node.js and browsers with child logger support and context inheritance.

## Features

- ✅ **Standard Interface**: Common logger interface with multiple log levels (debug, info, warn, error, fatal, trace)
- ✅ **Structured Logging**: Support for both structured (object + message) and simple (message only) logging
- ✅ **Child Loggers**: Create child loggers with inherited context
- ✅ **Automatic Timestamps**: Automatic timestamp injection on all log entries
- ✅ **Console-Based**: Built-in ConsoleLogger implementation using standard console methods
- ✅ **TypeScript**: Full TypeScript support with type-safe logging
- ✅ **Zero Dependencies**: No external dependencies

## Installation

```bash
pnpm add @geekmidas/logger
```

## Quick Start

```typescript
import { ConsoleLogger } from '@geekmidas/logger';

// Create logger with initial context
const logger = new ConsoleLogger({ app: 'myApp', version: '1.0.0' });

// Structured logging
logger.info({ userId: 123, action: 'login' }, 'User logged in');
// Output: { app: 'myApp', version: '1.0.0', userId: 123, action: 'login', ts: 1234567890 } User logged in

// Simple logging
logger.info('Application started');
// Output: { app: 'myApp', version: '1.0.0', ts: 1234567890 } Application started

// Error logging
logger.error({ error, operation: 'fetchUser' }, 'Failed to fetch user');
```

## API Reference

### Logger Interface

```typescript
interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  trace: LogFn;
  child: (obj: object) => Logger;
}
```

### Log Levels

- **trace** - Most detailed information
- **debug** - Verbose information for debugging
- **info** - General informational messages
- **warn** - Potentially harmful situations
- **error** - Error events that might still allow the application to continue
- **fatal** - Severe errors that will likely cause the application to abort

### ConsoleLogger

```typescript
class ConsoleLogger implements Logger {
  constructor(data?: object)

  debug: LogFn
  info: LogFn
  warn: LogFn
  error: LogFn
  fatal: LogFn
  trace: LogFn
  child(obj: object): Logger
}
```

## Usage Examples

### Basic Logging

```typescript
import { ConsoleLogger } from '@geekmidas/logger';

const logger = new ConsoleLogger({ service: 'api', environment: 'production' });

// Different log levels
logger.trace('Entering function');
logger.debug({ query: 'SELECT * FROM users' }, 'Executing query');
logger.info({ requestId: 'abc123' }, 'Request received');
logger.warn({ memoryUsage: '90%' }, 'High memory usage detected');
logger.error({ error: new Error('Connection failed') }, 'Database error');
logger.fatal({ exitCode: 1 }, 'Critical system failure');
```

### Structured Logging

```typescript
const logger = new ConsoleLogger({ app: 'myApp' });

// Log with context object
logger.info(
  {
    userId: 123,
    action: 'purchase',
    productId: 'prod_456',
    amount: 29.99
  },
  'Purchase completed'
);

// Multiple additional arguments
logger.info(
  { traceId: 'trace_123' },
  'Request processed in %dms',
  150
);
```

### Child Loggers

Child loggers inherit all context from their parent and add their own:

```typescript
const parentLogger = new ConsoleLogger({
  app: 'myApp',
  environment: 'production'
});

// Create child logger for authentication module
const authLogger = parentLogger.child({ module: 'auth' });
authLogger.info({ userId: 123 }, 'User authenticated');
// Output: { app: 'myApp', environment: 'production', module: 'auth', userId: 123, ts: ... }

// Create child logger for database module
const dbLogger = parentLogger.child({ module: 'database' });
dbLogger.debug({ query: 'SELECT ...' }, 'Query executed');
// Output: { app: 'myApp', environment: 'production', module: 'database', query: 'SELECT ...', ts: ... }

// Child loggers can be nested
const userDbLogger = dbLogger.child({ table: 'users' });
userDbLogger.info({ rowsAffected: 1 }, 'Record inserted');
// Output: { app: 'myApp', environment: 'production', module: 'database', table: 'users', rowsAffected: 1, ts: ... }
```

### Request Context Pattern

```typescript
import type { Logger } from '@geekmidas/logger';

function handleRequest(logger: Logger, requestId: string) {
  // Create request-scoped logger
  const requestLogger = logger.child({ requestId });

  requestLogger.info('Processing request');

  try {
    processPayment(requestLogger);
    requestLogger.info('Request completed');
  } catch (error) {
    requestLogger.error({ error }, 'Request failed');
  }
}

function processPayment(logger: Logger) {
  const paymentLogger = logger.child({ operation: 'payment' });
  paymentLogger.debug({ amount: 100 }, 'Processing payment');
  // All context is preserved: { requestId, operation, amount, ts }
}
```

### Integration with Services

```typescript
class UserService {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'UserService' });
  }

  async createUser(data: UserData) {
    this.logger.info({ email: data.email }, 'Creating user');

    try {
      const user = await this.db.insert(data);
      this.logger.info({ userId: user.id }, 'User created successfully');
      return user;
    } catch (error) {
      this.logger.error({ error, email: data.email }, 'Failed to create user');
      throw error;
    }
  }

  async deleteUser(userId: string) {
    const logger = this.logger.child({ userId, operation: 'delete' });

    logger.info('Deleting user');
    await this.db.delete(userId);
    logger.info('User deleted');
  }
}
```

## Custom Logger Implementation

You can implement the `Logger` interface for custom logging backends:

```typescript
import type { Logger, LogFn } from '@geekmidas/logger';

class CustomLogger implements Logger {
  constructor(private context: object = {}) {}

  private createLogFn(level: string): LogFn {
    return (obj: any, msg?: string, ...args: any[]) => {
      // Your custom logging implementation
      const logEntry = {
        level,
        ...this.context,
        ...obj,
        timestamp: new Date().toISOString(),
        message: msg
      };

      // Send to your logging service
      yourLoggingService.send(logEntry);
    };
  }

  debug: LogFn = this.createLogFn('debug');
  info: LogFn = this.createLogFn('info');
  warn: LogFn = this.createLogFn('warn');
  error: LogFn = this.createLogFn('error');
  fatal: LogFn = this.createLogFn('fatal');
  trace: LogFn = this.createLogFn('trace');

  child(obj: object): Logger {
    return new CustomLogger({ ...this.context, ...obj });
  }
}
```

## TypeScript Support

The library is written in TypeScript and provides full type definitions:

```typescript
import type { Logger, LogFn } from '@geekmidas/logger';

// Use Logger type for dependency injection
function createService(logger: Logger) {
  return {
    doWork() {
      logger.info('Working...');
    }
  };
}

// LogFn type for custom implementations
const customLog: LogFn = (obj, msg) => {
  console.log(obj, msg);
};
```

## Best Practices

1. **Create Base Logger Early**: Initialize your base logger at application startup with static context
   ```typescript
   const baseLogger = new ConsoleLogger({
     app: 'myApp',
     version: process.env.APP_VERSION,
     environment: process.env.NODE_ENV
   });
   ```

2. **Use Child Loggers**: Create child loggers for different modules/contexts rather than passing context repeatedly
   ```typescript
   const authLogger = baseLogger.child({ module: 'auth' });
   const dbLogger = baseLogger.child({ module: 'db' });
   ```

3. **Structured Over String**: Prefer structured logging with context objects over string concatenation
   ```typescript
   // Good
   logger.info({ userId, action: 'login', ip }, 'User logged in');

   // Avoid
   logger.info(`User ${userId} logged in from ${ip}`);
   ```

4. **Include Context**: Add relevant context to make logs searchable and debuggable
   ```typescript
   logger.error({
     error: err,
     userId,
     requestId,
     operation: 'fetchUser'
   }, 'Operation failed');
   ```

5. **Dependency Injection**: Pass logger as dependency rather than importing globally
   ```typescript
   class MyService {
     constructor(private logger: Logger) {}
   }
   ```

## License

MIT
