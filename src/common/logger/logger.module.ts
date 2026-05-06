import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { EnvConfig } from '../../config/env.config';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => {
        const env = config.get('NODE_ENV', { infer: true });
        const level = config.get('LOG_LEVEL', { infer: true });
        return {
          pinoHttp: {
            level,
            transport:
              env === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true, colorize: true } }
                : undefined,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                '*.password',
                '*.SUPABASE_SERVICE_ROLE_KEY',
                '*.SUPABASE_JWT_SECRET',
              ],
              censor: '[REDACTED]',
            },
            genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
          },
        };
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
