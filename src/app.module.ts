import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from './common/logger/logger.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MeModule } from './modules/me/me.module';
import { BatchesModule } from './modules/batches/batches.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { IssuanceModule } from './modules/issuance/issuance.module';
import { AdminModule } from './modules/admin/admin.module';
import { validateEnv } from './config/env.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    MeModule,
    BatchesModule,
    PortfolioModule,
    IssuanceModule,
    AdminModule,
  ],
})
export class AppModule {}
