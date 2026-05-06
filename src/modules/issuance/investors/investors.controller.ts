import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import type { AuthUser } from '../../auth/types';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { InvestorsService } from './investors.service';
import {
  InvestorsListQuerySchema,
  InvestorCreateSchema,
  type InvestorsListQuery,
  type InvestorCreate,
} from './investors.dto';

@ApiTags('investors')
@ApiBearerAuth()
@Controller('investors')
export class InvestorsController {
  constructor(private readonly investors: InvestorsService) {}

  @Get()
  @RequirePermission('investor.read')
  @UsePipes(new ZodValidationPipe(InvestorsListQuerySchema))
  list(@Query() query: InvestorsListQuery) {
    return this.investors.list(query);
  }

  @Get(':id')
  @RequirePermission('investor.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.investors.detail(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('investor.create')
  create(
    @Body(new ZodValidationPipe(InvestorCreateSchema)) body: InvestorCreate,
    @CurrentUser() user: AuthUser,
  ) {
    return this.investors.create({ input: body, actorId: user.id });
  }
}
