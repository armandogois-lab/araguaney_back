import { Body, Controller, Get, HttpCode, HttpStatus, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { SettingsService } from './settings.service';
import { SettingsUpdateSchema, type SettingsUpdate } from './settings.dto';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  get() {
    return this.settings.get();
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @RequirePermission('settings.manage')
  update(
    @Body(new ZodValidationPipe(SettingsUpdateSchema)) body: SettingsUpdate,
    @CurrentUser() user: AuthUser,
  ) {
    return this.settings.update(body, user.id);
  }
}
