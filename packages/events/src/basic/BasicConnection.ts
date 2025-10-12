import { EventEmitter } from 'node:events';
import type { EventConnection } from '../types';
import { EventPublisherType } from '../types';

export class BasicConnection implements EventConnection {
  readonly type = EventPublisherType.Basic;
  private emitter: EventEmitter;
  private connected = false;

  constructor() {
    this.emitter = new EventEmitter();
  }

  /**
   * Create a BasicConnection from a connection string
   * Format: basic://
   */
  static async fromConnectionString(
    _connectionString: string,
  ): Promise<BasicConnection> {
    // Basic connection doesn't need any configuration
    const connection = new BasicConnection();
    await connection.connect();
    return connection;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async close(): Promise<void> {
    this.emitter.removeAllListeners();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the underlying EventEmitter
   * Used by BasicPublisher and BasicSubscriber
   */
  get eventEmitter(): EventEmitter {
    return this.emitter;
  }
}
