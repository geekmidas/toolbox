export interface LogFn {
  <T extends object>(obj: T, msg?: string, ...args: any[]): void;
}

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  trace: LogFn;
  child: (obj: object) => Logger;
}

export class ConsoleLogger implements Logger {
  constructor(readonly data: object = {}) {}

  private createLogFn(logMethod: (...args: any[]) => void): LogFn {
    return <T extends object>(obj: T, msg?: string, ...args: any[]): void => {
      // Merge the logger's context data with the provided object
      const ts = Date.now();
      const mergedData = { ...this.data, ...obj, ts };

      if (msg) {
        logMethod(mergedData, msg, ...args);
      } else {
        logMethod(mergedData, ...args);
      }
    };
  }

  debug: LogFn = this.createLogFn(console.debug.bind(console));
  info: LogFn = this.createLogFn(console.info.bind(console));
  warn: LogFn = this.createLogFn(console.warn.bind(console));
  error: LogFn = this.createLogFn(console.error.bind(console));
  fatal: LogFn = this.createLogFn(console.error.bind(console));
  trace: LogFn = this.createLogFn(console.trace.bind(console));

  child(obj: object): Logger {
    return new ConsoleLogger({
      ...this.data,
      ...obj,
    });
  }
}

// Example usage:
// const logger = new ConsoleLogger({ app: 'myApp' });
// logger.info({ action: 'start' }, 'Application starting');
// // Logs: { app: 'myApp', action: 'start' } Application starting

// const childLogger = logger.child({ module: 'auth' });
// childLogger.debug({ userId: 123 }, 'User authenticated');
// // Logs: { app: 'myApp', module: 'auth', userId: 123 } User authenticated
