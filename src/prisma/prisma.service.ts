import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  type INestApplication,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Prisma } from '.prisma/client';
import { Logger } from 'nestjs-pino';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly logger: Logger) {
    super({
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ] satisfies Prisma.LogDefinition[],
    });
    // Bridge Prisma's event log into Pino
    (this as unknown as PrismaClient).$on('error' as never, (e: Prisma.LogEvent) =>
      this.logger.error({ err: e }, 'prisma error'),
    );
    (this as unknown as PrismaClient).$on('warn' as never, (e: Prisma.LogEvent) =>
      this.logger.warn({ err: e }, 'prisma warning'),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Wire process signals so the Nest application closes Prisma cleanly on shutdown.
   * Call from main.ts after `app.enableShutdownHooks()`.
   */
  enableShutdownHooks(app: INestApplication): void {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}
