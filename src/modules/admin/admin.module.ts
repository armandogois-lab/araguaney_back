import { Module } from '@nestjs/common';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { AuditController } from './audit/audit.controller';
import { AuditQueryService } from './audit/audit.service';
import { RolePermissionsController } from './role-permissions/role-permissions.controller';
import { RolePermissionsService } from './role-permissions/role-permissions.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

@Module({
  controllers: [SettingsController, AuditController, RolePermissionsController, UsersController],
  providers: [SettingsService, AuditQueryService, RolePermissionsService, UsersService],
})
export class AdminModule {}
