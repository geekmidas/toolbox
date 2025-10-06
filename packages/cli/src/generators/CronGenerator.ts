import { Cron } from '@geekmidas/api/server';
import type { BuildContext } from '../build/types';
import type { LegacyProvider } from '../types';
import { ConstructGenerator, type GeneratedConstruct } from './Generator';

export class CronGenerator extends ConstructGenerator<
  Cron<any, any, any, any>
> {
  generateHandlerFile(
    context: BuildContext,
    construct: GeneratedConstruct<Cron<any, any, any, any>>,
  ): Promise<string> {
    throw new Error('Method not implemented.');
  }
  buildConstruct(provider: LegacyProvider): Promise<string> {
    throw new Error('Method not implemented.');
  }
  isConstruct(value: any): value is Cron<any, any, any, any> {
    return Cron.isCron(value);
  }
}
