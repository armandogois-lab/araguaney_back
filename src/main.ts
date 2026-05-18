import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { initSentry } from './sentry';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { EnvConfig } from './config/env.config';

// Default Express body-parser limit is 100kb. A real cert issue posts
// the UUIDs of every order in the pool (up to 50k uuids ≈ 2-3 MB JSON).
// 10 MB leaves comfortable headroom while still capping malicious bloat.
const JSON_BODY_LIMIT = '10mb';

async function bootstrap(): Promise<void> {
  initSentry(process.env.SENTRY_DSN, process.env.NODE_ENV ?? 'development');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // Configure body-parser limits via NestExpressApplication's typed helper.
  // Must run before any request is served — does NOT double-register the
  // built-in parsers (unlike calling app.use(json()) directly).
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: JSON_BODY_LIMIT, extended: true });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(ConfigService<EnvConfig, true>);
  const port = config.get('PORT', { infer: true });
  const corsOrigins = config.get('CORS_ORIGINS', { infer: true });

  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalFilters(new AllExceptionsFilter(logger));
  app.use(helmet());
  app.enableCors({ origin: corsOrigins, credentials: true });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Cashea CFB API')
    .setDescription('Backend para emisión de Certificados de Financiamiento Bursátil')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port);
  logger.log(`Listening on http://localhost:${port}/api (CORS: ${corsOrigins.join(', ')})`);
}

void bootstrap();
