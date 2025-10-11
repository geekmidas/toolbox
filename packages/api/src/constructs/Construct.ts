export abstract class Construct {
  constructor(public readonly type: ConstructType) {}
}

export enum ConstructType {
  Cron = 'dev.geekmidas.function.cron',
  Endpoint = 'dev.geekmidas.function.endpoint',
  Function = 'dev.geekmidas.function.function',
  Subscriber = 'dev.geekmidas.function.subscriber',
}
