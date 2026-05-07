import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';

async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api', { exclude: ['health'] });

  const config = new DocumentBuilder()
    .setTitle('Cashea CFB API')
    .setDescription('Backend para emisión de Certificados de Financiamiento Bursátil')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);

  const outPath = join(process.cwd(), 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
  console.log(`OpenAPI spec written to ${outPath}`);

  await app.close();
}

void exportOpenApi().catch((err) => {
  console.error(err);
  process.exit(1);
});
