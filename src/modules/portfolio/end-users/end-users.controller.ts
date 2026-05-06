import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { EndUsersService } from './end-users.service';
import {
  EndUsersListQuerySchema,
  EndUserUpdateSchema,
  type EndUsersListQuery,
  type EndUserUpdate,
} from './end-users.dto';

@ApiTags('end-users')
@ApiBearerAuth()
@Controller('end-users')
export class EndUsersController {
  constructor(private readonly endUsers: EndUsersService) {}

  @Get()
  @RequirePermission('portfolio.read')
  @UsePipes(new ZodValidationPipe(EndUsersListQuerySchema))
  list(@Query() query: EndUsersListQuery) {
    return this.endUsers.list(query);
  }

  @Get(':id')
  @RequirePermission('portfolio.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.endUsers.detail(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('portfolio.write')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(EndUserUpdateSchema)) body: EndUserUpdate,
    @CurrentUser() user: AuthUser,
  ) {
    return this.endUsers.update({ id, patch: body, actorId: user.id });
  }
}
