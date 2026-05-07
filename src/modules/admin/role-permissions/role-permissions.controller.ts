import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { RolePermissionsService } from './role-permissions.service';
import { RoleParamSchema, PermissionKeyParamSchema, type RoleParam } from './role-permissions.dto';

@ApiTags('role-permissions')
@ApiBearerAuth()
@Controller('role-permissions')
export class RolePermissionsController {
  constructor(private readonly rolePermissions: RolePermissionsService) {}

  @Get()
  @RequirePermission('permission.manage')
  getMatrix() {
    return this.rolePermissions.getMatrix();
  }

  @Put(':role/:permission_key')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('permission.manage')
  grant(
    @Param('role', new ZodValidationPipe(RoleParamSchema)) role: RoleParam,
    @Param('permission_key', new ZodValidationPipe(PermissionKeyParamSchema)) permissionKey: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rolePermissions.grant(role, permissionKey, user.id);
  }

  @Delete(':role/:permission_key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('permission.manage')
  revoke(
    @Param('role', new ZodValidationPipe(RoleParamSchema)) role: RoleParam,
    @Param('permission_key', new ZodValidationPipe(PermissionKeyParamSchema)) permissionKey: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rolePermissions.revoke(role, permissionKey, user.id);
  }
}
