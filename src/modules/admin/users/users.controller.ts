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
import { UsersService } from './users.service';
import {
  UsersListQuerySchema,
  UserUpdateSchema,
  type UsersListQuery,
  type UserUpdate,
} from './users.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('user.read')
  @UsePipes(new ZodValidationPipe(UsersListQuerySchema))
  list(@Query() query: UsersListQuery) {
    return this.users.list(query);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('user.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UserUpdateSchema)) body: UserUpdate,
    @CurrentUser() user: AuthUser,
  ) {
    return this.users.update(user.id, id, body);
  }
}
