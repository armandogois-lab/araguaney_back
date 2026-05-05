import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { version as appVersion } from '../package.json';

async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Araguaney API')
    .setDescription('Backend del sistema de empaquetado CFB de Cashea')
    .setVersion(appVersion)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);

  const outputPath = resolve(process.cwd(), 'openapi.json');
  writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf8');

  await app.close();

  // eslint-disable-next-line no-console
  console.log(`OpenAPI spec written to ${outputPath}`);
}

exportOpenApi().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to export OpenAPI spec', err);
  process.exit(1);
});
