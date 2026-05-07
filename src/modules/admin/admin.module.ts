import { Module } from '@nestjs/common';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { AuditController } from './audit/audit.controller';
import { AuditQueryService } from './audit/audit.service';

@Module({
  controllers: [SettingsController, AuditController],
  providers: [SettingsService, AuditQueryService],
})
export class AdminModule {}
